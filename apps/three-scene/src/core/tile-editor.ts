import * as THREE from 'three';

import { decodeVox, VoxelBatch, type Voxel } from '@cbnsndwch/world-core';
import {
    groundLayersFor,
    isAllowedResolution,
    VOXEL_PER_TILE
} from '@cbnsndwch/scene-author';

import { CONFIG } from '../config.js';
import { History } from './history.js';
import type { SceneView } from './scene-view.js';

const PER_TILE = CONFIG.voxel.perTile; // 12 — base voxels per cell edge
/** Tallest a base-resolution (r=12) tile may rise, in voxel layers. */
const MAX_Z_BASE = 64;
/** Fixed palette size — an 8×32 grid, matching the importable palette image. */
const PALETTE_SIZE = 256;
/** Discrete shade levels the Shade tool quantizes a color to. */
const SHADE_STEPS = 7;
/** Rendered for a voxel whose palette slot was cleared/unassigned (flags the orphan). */
const FALLBACK_COLOR = '#ff00ff';

export type EditTool = 'add' | 'delete' | 'paint' | 'eyedropper' | 'select' | 'face-select';

/** A named visibility group for a subset of voxels. */
export interface EditorLayer {
    id: string;
    name: string;
    visible: boolean;
}

/**
 * Editor-internal voxel: position plus the palette **slot index** that colors it.
 * The index is the source of truth — editing a slot's color (or swapping the whole
 * palette) recolors every voxel pointing at it. The hex {@link Voxel} world-core
 * wants is produced on demand at the render/save boundary by
 * {@link TileEditor.materialize}.
 */
interface EditVoxel {
    x: number;
    y: number;
    z: number;
    /** Index into {@link TileEditor.palette}. */
    ci: number;
    /** Layer this voxel belongs to, if any. */
    layerId?: string | null;
}

/** Undoable document state: the voxels, the palette that colors them, and named layers. */
interface TileSnapshot {
    voxels: EditVoxel[];
    palette: (string | null)[];
    layers: EditorLayer[];
}

const DEFAULT_PALETTE = [
    '#fafaf5',
    '#cdc8b8',
    '#b5b0a2',
    '#8d8878',
    '#e8d4a8',
    '#c4622e',
    '#7eaa5f',
    '#5c8a44',
    '#7a9460',
    '#a07344',
    '#1b5ba8',
    '#3a3833'
];

/** A 256-slot palette seeded with the defaults; the rest are unassigned (null). */
function makeDefaultPalette(): (string | null)[] {
    const slots: (string | null)[] = new Array(PALETTE_SIZE).fill(null);
    for (let i = 0; i < DEFAULT_PALETTE.length; i++)
        slots[i] = DEFAULT_PALETTE[i]!;
    return slots;
}

/** Pad/truncate a color list to exactly {@link PALETTE_SIZE} slots. */
function toSlots(colors: readonly (string | null)[]): (string | null)[] {
    const slots: (string | null)[] = new Array(PALETTE_SIZE).fill(null);
    for (let i = 0; i < Math.min(colors.length, PALETTE_SIZE); i++) {
        slots[i] = colors[i] ?? null;
    }
    return slots;
}

/**
 * Authors a single 12×12×H tile by per-voxel editing — the granularity the scene
 * builder lacks. Reuses {@link VoxelBatch} for display and an invisible
 * InstancedMesh hitbox (on layer 1) for face-normal raycasting. A persistent
 * selection set (the Select tool) lets Delete/Paint act on many voxels at once.
 * The model is centered at the world origin, rising from y = 0; a datum plane
 * marks the layer (z = groundLayers) that meets scene ground, so authors can see
 * which layers get buried.
 */
export class TileEditor {
    voxels: EditVoxel[] = [];
    /**
     * Grid footprint `[w, d]` in cells. A multi-cell footprint authors the tile
     * at `(w·12) × (d·12)` voxels (buildings); the default 1×1 is the legacy
     * 12×12 author grid. Drives {@link nx}/{@link ny}.
     */
    footprint: [number, number] = [1, 1];
    /**
     * Per-asset resolution `r` (voxels per cell edge), default 12. A higher `r`
     * authors finer cubes inside the same world cell, so the author grid is
     * `(w·r) × (d·r)` voxels and the buried datum sits proportionally deeper.
     */
    resolution: number = PER_TILE;
    /** Author-grid voxel extents, derived from the footprint × resolution. */
    private nx: number = PER_TILE;
    private ny: number = PER_TILE;
    /** Fixed 256-slot palette; null = unassigned (shown as an empty swatch). */
    palette: (string | null)[] = makeDefaultPalette();
    activeColorIdx = 0;
    tool: EditTool = 'add';
    /** Selected voxel position keys ("x,y,z"). */
    readonly selection = new Set<string>();
    /** Anchor for planar range selection — set on each bare click with the Select tool. */
    selectionAnchor: { x: number; y: number; z: number } | null = null;
    /**
     * When true the selection overlay mesh is hidden so the author can inspect
     * the underlying voxel colors without disturbing the selection.
     */
    selectionPeek = false;
    /** Id of the tile being edited (set by {@link loadTile}); null for a new tile. */
    editingId: string | null = null;
    gridOn = false;
    edgesOn = false;
    groundGridOn = true;
    wallsOn = true;
    /** Exploded view: extra vertical gap (in voxels) inserted between layers. */
    explode = 0;
    /** When set, only this z layer is shown (isolate a layer); null = all. */
    focusLayer: number | null = null;

    private _layers = new Map<string, EditorLayer>();
    private _layerCounter = 0;

    get layers(): EditorLayer[] {
        return [...this._layers.values()];
    }

    private get halfX(): number {
        return this.nx / 2;
    }

    private get halfY(): number {
        return this.ny / 2;
    }

    /** Buried base-layer count for the current resolution (datum sits here). */
    private get ground(): number {
        return groundLayersFor(this.resolution);
    }

    /**
     * Tallest the tile may rise, in voxel layers — the base cap scaled by `r`
     * (PRD §5.6) so the *world* height budget is resolution-independent. Stays
     * within the `.vox` 256-layer limit (64 × 48/12 = 256).
     */
    private get zCap(): number {
        return MAX_Z_BASE * (this.resolution / PER_TILE);
    }

    private readonly root = new THREE.Group();
    private readonly display = new THREE.Group();
    private hitMesh: THREE.InstancedMesh | null = null;
    /** Voxels backing the hit mesh, in instance order (the visible subset). */
    private hitVoxels: EditVoxel[] = [];
    private selectionMesh: THREE.InstancedMesh | null = null;
    private edges: THREE.LineSegments | null = null;
    private grid!: THREE.Group;
    private groundGridMesh: THREE.Group | null = null;
    private wallsGroup: THREE.Group | null = null;
    private wallFaces: Record<'px' | 'nx' | 'pz' | 'nz', THREE.Group | null> = { px: null, nx: null, pz: null, nz: null };
    private datum: THREE.Group | null = null;
    private readonly hitGeo = new THREE.BoxGeometry(1, 1, 1);
    private readonly hitMat = new THREE.MeshBasicMaterial();
    private readonly selGeo = new THREE.BoxGeometry(1.12, 1.12, 1.12);
    private readonly selMat = new THREE.MeshBasicMaterial({
        color: 0xffcf3a,
        transparent: true,
        opacity: 0.45,
        depthWrite: false
    });
    /** Unit-cube edge vertices (24, as 12 line segments) replicated per voxel. */
    private readonly edgeTemplate = new THREE.EdgesGeometry(
        this.hitGeo
    ).getAttribute('position').array as Float32Array;
    private readonly edgeMat = new THREE.LineBasicMaterial({
        color: 0x2a2a2a,
        transparent: true,
        opacity: 0.35
    });
    private readonly raycaster = new THREE.Raycaster();
    private readonly floorPlane = new THREE.Plane(
        new THREE.Vector3(0, 1, 0),
        0
    );
    /** Last target acted on this stroke — dedups drag cascades / fall-through. */
    private lastTargetKey: string | null = null;

    /** Called after any edit so the UI (panels, info) can refresh. */
    onChange: (() => void) | null = null;

    private readonly history = new History<TileSnapshot>();
    /** Pre-mutation state of the open transaction; null when none is open. */
    private txBefore: TileSnapshot | null = null;
    /** Coalesce key of the open transaction (groups continuous edits). */
    private txKey: string | null = null;
    /** Coalesce key of the last recorded step; matching keys fold together. */
    private lastCommitKey: string | null = null;

    constructor(private readonly view: SceneView) {
        this.raycaster.layers.set(1);
        this.root.visible = false;
        this.root.add(this.display);
        this.buildFloor();
        this.view.scene.add(this.root);
        this.view.controls.addEventListener('change', () => this.updateWallsForCamera());
    }

    get activeColor(): string {
        return this.palette[this.activeColorIdx] ?? '#ffffff';
    }

    setActive(active: boolean): void {
        this.root.visible = active;
        if (active) this.rebuild();
    }

    /** Start a fresh, empty tile. */
    reset(): void {
        this.voxels = [];
        this.palette = makeDefaultPalette();
        this.activeColorIdx = 0;
        this.tool = 'add';
        this.editingId = null;
        this.explode = 0;
        this.focusLayer = null;
        this.selection.clear();
        this.selectionAnchor = null;
        this._layers.clear();
        this.applyFootprint([1, 1], PER_TILE);
        this.resetHistory();
        this.rebuild();
        this.onChange?.();
    }

    /**
     * Resize the author grid to a new footprint `[w, d]` (buildings). Voxels that
     * fall outside the new `(w·12) × (d·12)` extent are dropped, and the floor
     * grid + datum + camera frame are rebuilt. A no-op when unchanged.
     */
    setFootprint(footprint: [number, number]): void {
        const w = Math.max(1, Math.min(8, Math.round(footprint[0])));
        const d = Math.max(1, Math.min(8, Math.round(footprint[1])));
        if (w === this.footprint[0] && d === this.footprint[1]) return;
        this.transact(() => {
            this.applyFootprint([w, d], this.resolution);
            this.voxels = this.voxels.filter(
                v => v.x >= 0 && v.x < this.nx && v.y >= 0 && v.y < this.ny
            );
            this.selection.clear();
            this.selectionAnchor = null;
            this.rebuild();
            this.onChange?.();
        });
    }

    /**
     * Change the per-asset resolution `r` (voxels per cell edge). The author grid
     * scales to `(w·r) × (d·r)`; voxels outside the new extent are dropped, and
     * the floor / datum / camera reframe. A no-op when unchanged or invalid.
     */
    setResolution(resolution: number): void {
        const r = Math.round(resolution);
        if (r === this.resolution || !isAllowedResolution(r)) return;
        this.transact(() => {
            this.applyFootprint(this.footprint, r);
            this.voxels = this.voxels.filter(
                v =>
                    v.x >= 0 &&
                    v.x < this.nx &&
                    v.y >= 0 &&
                    v.y < this.ny &&
                    v.z < this.zCap
            );
            this.selection.clear();
            this.selectionAnchor = null;
            this.rebuild();
            this.onChange?.();
        });
    }

    /** Set the footprint + resolution + derived extents and rebuild / re-frame. */
    private applyFootprint(
        footprint: [number, number],
        resolution: number = this.resolution
    ): void {
        this.footprint = footprint;
        this.resolution = resolution;
        this.nx = footprint[0] * resolution;
        this.ny = footprint[1] * resolution;
        if (this.grid) this.buildFloor();
        // Pure voxel space (unit cubes): frame by the larger voxel extent, not
        // world cell size, so the camera fits any resolution (PRD R4).
        this.view.frameEdit(Math.max(this.nx, this.ny));
    }

    /**
     * Load an existing tile's voxels + saved palette for editing.
     * {@link editingId} is set so a save overwrites the same tile.
     */
    loadTile(
        voxels: readonly Voxel[],
        id: string,
        palette?: readonly (string | null)[],
        footprint: [number, number] = [1, 1],
        resolution: number = PER_TILE
    ): void {
        this.load(voxels, palette, id, footprint, resolution);
    }

    /**
     * Load voxels + palette from an imported `.vox` as a *new* tile (no
     * {@link editingId}), so saving creates a fresh catalog entry.
     */
    loadExternal(
        voxels: readonly Voxel[],
        palette?: readonly (string | null)[]
    ): void {
        this.load(voxels, palette, null, [1, 1], PER_TILE);
    }

    /** Decode a `.vox` buffer and load it as a new tile. Returns success. */
    importVoxBuffer(buffer: ArrayBuffer): boolean {
        try {
            const asset = decodeVox(buffer);
            this.loadExternal(asset.voxels, asset.palette);
            return true;
        } catch {
            return false;
        }
    }

    private load(
        voxels: readonly Voxel[],
        palette: readonly (string | null)[] | undefined,
        id: string | null,
        footprint: [number, number] = [1, 1],
        resolution: number = PER_TILE
    ): void {
        // Re-entering the same tile (e.g. Save → Done → back to edit) preserves
        // the full editing session — voxels, history, selection all stay intact.
        if (id != null && id === this.editingId) {
            this.rebuild();
            this.onChange?.();
            return;
        }
        this.applyFootprint(
            [Math.max(1, footprint[0]), Math.max(1, footprint[1])],
            isAllowedResolution(resolution) ? resolution : PER_TILE
        );
        const hexes = voxels.map(v => v.c.toLowerCase());
        this.palette = this.resolvePalette(hexes, palette);
        // Point every voxel at its palette slot. Colors derive from / were saved
        // with this palette, so lookups hit; ensureIndex covers any stragglers.
        const idx = this.hexIndex();
        this.voxels = voxels.map((v, k) => {
            const c = hexes[k]!;
            let i = idx.get(c);
            if (i == null) {
                i = this.ensureIndex(c);
                idx.set(c, i);
            }
            return { x: v.x, y: v.y, z: v.z, ci: i };
        });
        const first = this.palette.findIndex(c => c != null);
        this.activeColorIdx = first >= 0 ? first : 0;
        this.tool = 'add';
        this.editingId = id;
        this.explode = 0;
        this.focusLayer = null;
        this.selection.clear();
        this.selectionAnchor = null;
        this._layers.clear();
        this.resetHistory();
        this.rebuild();
        this.onChange?.();
    }

    /** Use the saved palette when present; otherwise derive from voxel colors. */
    private resolvePalette(
        hexes: readonly string[],
        palette?: readonly (string | null)[]
    ): (string | null)[] {
        if (palette && palette.some(c => c != null)) return toSlots(palette);
        const colors: string[] = [];
        const seen = new Set<string>();
        for (const c of hexes) {
            if (!seen.has(c)) {
                seen.add(c);
                colors.push(c);
            }
        }
        return colors.length ? toSlots(colors) : makeDefaultPalette();
    }

    /** First slot index for each assigned color — for resolving hex → slot. */
    private hexIndex(): Map<string, number> {
        const m = new Map<string, number>();
        for (let i = 0; i < this.palette.length; i++) {
            const c = this.palette[i];
            if (c != null && !m.has(c)) m.set(c, i);
        }
        return m;
    }

    /** Slot index of `hex`, assigning it to a free slot if not already present. */
    private ensureIndex(hex: string): number {
        const c = hex.toLowerCase();
        const existing = this.palette.indexOf(c);
        if (existing >= 0) return existing;
        const free = this.palette.indexOf(null);
        const i = free >= 0 ? free : 0;
        this.palette[i] = c;
        return i;
    }

    /** Resolve editor voxels to world-core hex {@link Voxel}s (the render/save seam). */
    materialize(voxels: readonly EditVoxel[] = this.voxels): Voxel[] {
        return voxels.map(v => ({
            x: v.x,
            y: v.y,
            z: v.z,
            c: this.palette[v.ci] ?? FALLBACK_COLOR
        }));
    }

    /** True if any voxel is colored by palette slot `i`. */
    slotInUse(i: number): boolean {
        return this.voxels.some(v => v.ci === i);
    }

    setTool(t: EditTool): void {
        this.tool = t;
        this.onChange?.();
    }

    /** Make `hex` the active color, assigning it to its slot (or the first free one). */
    setColor(hex: string): void {
        this.transact(() => {
            const c = hex.toLowerCase();
            const existing = this.palette.indexOf(c);
            if (existing >= 0) {
                this.activeColorIdx = existing;
            } else {
                const free = this.palette.indexOf(null);
                const i = free >= 0 ? free : this.activeColorIdx;
                this.palette[i] = c;
                this.activeColorIdx = i;
            }
            this.onChange?.();
        });
    }

    /**
     * Assign a color to a specific palette slot (from the swatch popover). Voxels
     * reference slots by index, so this live-recolors every voxel using slot `i`.
     */
    setSlotColor(i: number, hex: string): void {
        if (i < 0 || i >= PALETTE_SIZE) return;
        // Coalesce by slot so dragging a single color slider is one undo step.
        this.transact(() => {
            this.palette[i] = hex.toLowerCase();
            this.activeColorIdx = i;
            this.rebuild();
            this.onChange?.();
        }, `slot:${i}`);
    }

    /** Unassign a palette slot. Refuses while a voxel still uses it (would orphan). */
    clearSlot(i: number): void {
        if (i < 0 || i >= PALETTE_SIZE || this.palette[i] == null) return;
        if (this.slotInUse(i)) return;
        this.transact(() => {
            this.palette[i] = null;
            if (this.activeColorIdx === i) {
                const next = this.palette.findIndex(c => c != null);
                this.activeColorIdx = next >= 0 ? next : 0;
            }
            this.onChange?.();
        });
    }

    /**
     * Replace the whole palette (e.g. imported from an image, or a saved library
     * palette). Voxels keep their slot index, so they recolor against the new
     * palette; any voxel whose slot is now unassigned renders {@link FALLBACK_COLOR}.
     */
    setPalette(colors: readonly (string | null)[]): void {
        this.transact(() => {
            this.palette = toSlots(colors);
            const first = this.palette.findIndex(c => c != null);
            this.activeColorIdx = first >= 0 ? first : 0;
            this.rebuild();
            this.onChange?.();
        });
    }

    /**
     * Permute the palette so the new slot `i` holds old slot `order[i]`, remapping
     * every voxel's index so colors stay attached (the model is visually
     * unchanged). `order` must be a permutation of 0…{@link PALETTE_SIZE}-1.
     */
    reorderPalette(order: readonly number[]): void {
        this.transact(() => {
            const next: (string | null)[] = new Array(PALETTE_SIZE).fill(null);
            const oldToNew: number[] = new Array(PALETTE_SIZE).fill(0);
            for (let i = 0; i < PALETTE_SIZE; i++) {
                const old = order[i]!;
                next[i] = this.palette[old] ?? null;
                oldToNew[old] = i;
            }
            for (const v of this.voxels) v.ci = oldToNew[v.ci]!;
            this.palette = next;
            this.activeColorIdx = oldToNew[this.activeColorIdx]!;
            this.rebuild();
            this.onChange?.();
        });
    }

    /** Sort assigned colors (by hue or lightness) to the front; empties trail. */
    sortPalette(key: 'hue' | 'light'): void {
        const assigned: number[] = [];
        const empty: number[] = [];
        for (let i = 0; i < this.palette.length; i++) {
            if (this.palette[i] != null) assigned.push(i);
            else empty.push(i);
        }
        const metric = key === 'hue' ? hexHue : hexLuma;
        assigned.sort(
            (a, b) => metric(this.palette[a]!) - metric(this.palette[b]!)
        );
        this.reorderPalette([...assigned, ...empty]);
    }

    /* ── Color generators (populate free slots) ───────────────────── */

    /**
     * Add a `steps`-stop RGB ramp from the active color to `targetHex` into free
     * slots (endpoints included; already-present colors are skipped). Returns
     * false without changing anything if there aren't enough free slots.
     */
    rampTo(targetHex: string, steps: number): boolean {
        const from = hexToRgb(this.activeColor);
        const to = hexToRgb(targetHex);
        const n = Math.max(2, Math.min(16, Math.round(steps)));
        const out: string[] = [];
        for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            out.push(
                rgbToHex([
                    clamp8(from[0] + (to[0] - from[0]) * t),
                    clamp8(from[1] + (to[1] - from[1]) * t),
                    clamp8(from[2] + (to[2] - from[2]) * t)
                ])
            );
        }
        return this.transact(() => this.addColors(out));
    }

    /**
     * Add harmony colors derived from the active color (same S/L, rotated hue):
     * complement (+180°), analogous (±30°), or triad (±120°). Returns false if
     * there aren't enough free slots.
     */
    harmony(kind: 'complement' | 'analogous' | 'triad'): boolean {
        const [h, s, l] = hexToHsl(this.activeColor);
        const offsets =
            kind === 'complement'
                ? [180]
                : kind === 'analogous'
                  ? [30, -30]
                  : [120, -120];
        return this.transact(() =>
            this.addColors(offsets.map(d => hslToHex(h + d, s, l)))
        );
    }

    /** Add the distinct, not-yet-present colors to free slots; false if no room. */
    private addColors(colors: readonly string[]): boolean {
        const distinct = [...new Set(colors.map(c => c.toLowerCase()))].filter(
            c => !this.palette.includes(c)
        );
        if (distinct.length > this.freeSlotCount()) return false;
        for (const c of distinct) this.ensurePaletteColor(c);
        if (distinct.length) this.onChange?.();
        return true;
    }

    selectColorIdx(i: number): void {
        if (i >= 0 && i < PALETTE_SIZE && this.palette[i] != null) {
            this.activeColorIdx = i;
            // Picking a slot ends any slider-coalescing run on it (reopen = new step).
            this.lastCommitKey = null;
            this.onChange?.();
        }
    }

    /**
     * Toggle the selection overlay visibility without changing the selection.
     * Useful for a quick before/after peek while keeping the selection intact.
     */
    setSelectionPeek(on: boolean): void {
        if (this.selectionPeek === on) return;
        this.selectionPeek = on;
        if (this.selectionMesh) this.selectionMesh.visible = !on;
        this.onChange?.();
    }

    clearSelection(): void {
        if (this.selection.size === 0) return;
        this.selection.clear();
        this.selectionAnchor = null;
        this.rebuildSelection();
        this.onChange?.();
    }

    /* ── Selection-set operations (context menu) ──────────────────── */

    /** Remove every selected voxel. */
    deleteSelection(): void {
        if (this.selection.size === 0) return;
        this.transact(() => {
            this.voxels = this.voxels.filter(
                v => !this.selection.has(keyOf(v.x, v.y, v.z))
            );
            this.selection.clear();
            this.selectionAnchor = null;
            this.rebuild();
            this.onChange?.();
        });
    }

    /** Recolor every selected voxel; the selection stays so it can be reused. */
    recolorSelection(hex: string): void {
        if (this.selection.size === 0) return;
        // Coalesce: scrubbing the recolor picker over one selection is one step.
        this.transact(() => {
            this.setColor(hex); // ensure it's in the palette + active
            const ci = this.activeColorIdx;
            for (const v of this.voxels) {
                if (this.selection.has(keyOf(v.x, v.y, v.z))) v.ci = ci;
            }
            this.rebuild();
            this.onChange?.();
        }, 'recolor-selection');
    }

    /**
     * Translate the selection by `(dx, dy, dz)` voxels, carrying the selection
     * with it. Aborts (returns false, no change) if any voxel would leave the
     * grid or collide with an unselected voxel.
     */
    moveSelection(dx: number, dy: number, dz: number): boolean {
        if (this.selection.size === 0) return false;
        return this.transact(() => this.moveSelectionInner(dx, dy, dz));
    }

    private moveSelectionInner(dx: number, dy: number, dz: number): boolean {
        const fixed = new Set<string>();
        for (const v of this.voxels) {
            const k = keyOf(v.x, v.y, v.z);
            if (!this.selection.has(k)) fixed.add(k);
        }
        const moves: { v: EditVoxel; nx: number; ny: number; nz: number }[] =
            [];
        for (const v of this.voxels) {
            if (!this.selection.has(keyOf(v.x, v.y, v.z))) continue;
            const nx = v.x + dx;
            const ny = v.y + dy;
            const nz = v.z + dz;
            if (
                nx < 0 ||
                ny < 0 ||
                nx >= this.nx ||
                ny >= this.ny ||
                nz < 0 ||
                nz >= this.zCap
            ) {
                return false;
            }
            if (fixed.has(keyOf(nx, ny, nz))) return false;
            moves.push({ v, nx, ny, nz });
        }
        this.selection.clear();
        this.selectionAnchor = null;
        for (const m of moves) {
            m.v.x = m.nx;
            m.v.y = m.ny;
            m.v.z = m.nz;
            this.selection.add(keyOf(m.nx, m.ny, m.nz));
        }
        this.rebuild();
        this.onChange?.();
        return true;
    }

    /* ── Bulk clear actions ───────────────────────────────────── */

    /** Fill the buried base layers (z 0..ground-1) with the active color. */
    fillBase(): void {
        this.transact(() => {
            const occ = this.occupied();
            const ground = this.ground;
            for (let z = 0; z < ground; z++) {
                for (let y = 0; y < this.ny; y++) {
                    for (let x = 0; x < this.nx; x++) {
                        if (!occ.has(keyOf(x, y, z))) {
                            this.voxels.push({
                                x,
                                y,
                                z,
                                ci: this.activeColorIdx
                            });
                        }
                    }
                }
            }
            this.rebuild();
            this.onChange?.();
        });
    }

    /** Remove the buried base layers (z < ground). */
    clearBase(): void {
        this.transact(() => {
            const ground = this.ground;
            this.voxels = this.voxels.filter(v => v.z >= ground);
            this.rebuild();
            this.onChange?.();
        });
    }

    /** Remove everything above ground (z >= ground). */
    clearTop(): void {
        this.transact(() => {
            const ground = this.ground;
            this.voxels = this.voxels.filter(v => v.z < ground);
            this.rebuild();
            this.onChange?.();
        });
    }

    /* ── Shading + hull ───────────────────────────────────────── */

    /**
     * Give the tile a hand-shaded look: recolor each voxel (the selection if any,
     * else all) to a brightness-jittered variant of the active color, sampled
     * from a normal distribution. Jitter is quantized to a few discrete shades
     * (added to the palette) so the bounded-palette aesthetic — and the 255-color
     * `.vox` limit — is respected. `spread` (0–100) scales the variance.
     */
    applyShading(spread: number): boolean {
        if (!this.voxels.length) return true;
        return this.transact(() => {
            const shades = this.shadePalette(spread);
            const distinct = [...new Set(shades.map(s => s.toLowerCase()))];
            const missing = distinct.filter(s => !this.palette.includes(s));
            // Refuse rather than silently overflow the bounded palette.
            if (missing.length > this.freeSlotCount()) return false;
            for (const s of missing) this.ensurePaletteColor(s);
            // Map each shade to its (now-present) slot so voxels point at indices.
            const shadeIdx = shades.map(s =>
                this.palette.indexOf(s.toLowerCase())
            );
            const sel = this.selection;
            const pick = (): number => {
                const z = Math.max(-2.5, Math.min(2.5, gaussian()));
                const idx = Math.round(((z + 2.5) / 5) * (SHADE_STEPS - 1));
                return shadeIdx[Math.max(0, Math.min(SHADE_STEPS - 1, idx))]!;
            };
            for (const v of this.voxels) {
                if (sel.size === 0 || sel.has(keyOf(v.x, v.y, v.z)))
                    v.ci = pick();
            }
            this.rebuild();
            this.onChange?.();
            return true;
        });
    }

    /** The SHADE_STEPS discrete shade colors the current settings would produce. */
    private shadePalette(spread: number): string[] {
        const base = hexToRgb(this.activeColor);
        const maxDev = (Math.max(0, Math.min(100, spread)) / 100) * 0.5;
        const out: string[] = [];
        for (let i = 0; i < SHADE_STEPS; i++) {
            const f = 1 + ((i / (SHADE_STEPS - 1)) * 2 - 1) * maxDev; // 1±maxDev
            out.push(
                rgbToHex([
                    clamp8(base[0] * f),
                    clamp8(base[1] * f),
                    clamp8(base[2] * f)
                ])
            );
        }
        return out;
    }

    /* ── Palette space management ─────────────────────────────── */

    /** New palette slots a Shade needs (distinct shades not yet in the palette). */
    shadeSlotsNeeded(spread: number): number {
        const distinct = new Set(
            this.shadePalette(spread).map(s => s.toLowerCase())
        );
        let n = 0;
        for (const s of distinct) if (!this.palette.includes(s)) n++;
        return n;
    }

    freeSlotCount(): number {
        return this.palette.reduce<number>(
            (n, c) => (c == null ? n + 1 : n),
            0
        );
    }

    /** Count of assigned palette slots not referenced by any voxel. */
    unusedColorCount(): number {
        const used = new Set(this.voxels.map(v => v.ci));
        return this.palette.reduce<number>(
            (n, c, i) => (c != null && !used.has(i) ? n + 1 : n),
            0
        );
    }

    /** Unassign palette slots no voxel uses (e.g. imported junk); returns count. */
    removeUnusedColors(): number {
        return this.transact(() => {
            const used = new Set(this.voxels.map(v => v.ci));
            let removed = 0;
            for (let i = 0; i < this.palette.length; i++) {
                if (this.palette[i] != null && !used.has(i)) {
                    this.palette[i] = null;
                    removed++;
                }
            }
            if (this.palette[this.activeColorIdx] == null) {
                const first = this.palette.findIndex(c => c != null);
                this.activeColorIdx = first >= 0 ? first : 0;
            }
            if (removed) this.onChange?.();
            return removed;
        });
    }

    /**
     * Drop voxels that are fully enclosed (all six face-neighbors occupied) and
     * thus never visible — the equivalent of MagicaVoxel's Hull, trimming file
     * size and draw work without changing the silhouette.
     */
    hull(): void {
        if (!this.voxels.length) return;
        this.transact(() => {
            const occ = this.occupied();
            const buried = (v: EditVoxel): boolean =>
                occ.has(keyOf(v.x + 1, v.y, v.z)) &&
                occ.has(keyOf(v.x - 1, v.y, v.z)) &&
                occ.has(keyOf(v.x, v.y + 1, v.z)) &&
                occ.has(keyOf(v.x, v.y - 1, v.z)) &&
                occ.has(keyOf(v.x, v.y, v.z + 1)) &&
                occ.has(keyOf(v.x, v.y, v.z - 1));
            this.voxels = this.voxels.filter(v => !buried(v));
            this.rebuild();
            this.onChange?.();
        });
    }

    /* ── Floor (geometry z-shift) ─────────────────────────────── */

    /**
     * Shift the whole model in z, clamped to stay within the resolution's voxel
     * height budget. This bakes into the saved geometry, so the chosen burial
     * depth determines where the tile lands when placed (the datum at z = ground
     * marks the scene ground line).
     */
    shiftZ(dz: number): void {
        if (!this.voxels.length || dz === 0) return;
        this.transact(() => {
            let minZ = Infinity;
            let maxZ = -Infinity;
            for (const v of this.voxels) {
                if (v.z < minZ) minZ = v.z;
                if (v.z > maxZ) maxZ = v.z;
            }
            const top = this.zCap - 1;
            let d = dz;
            if (minZ + d < 0) d = -minZ;
            if (maxZ + d > top) d = top - maxZ;
            if (d === 0) return;
            for (const v of this.voxels) v.z += d;
            if (this.selection.size) {
                const shifted = [...this.selection].map(k => {
                    const [x, y, z] = k.split(',').map(Number) as [
                        number,
                        number,
                        number
                    ];
                    return keyOf(x, y, z + d);
                });
                this.selection.clear();
                for (const k of shifted) this.selection.add(k);
            }
            this.rebuild();
            this.onChange?.();
        });
    }

    raiseFloor(): void {
        this.shiftZ(1);
    }

    lowerFloor(): void {
        this.shiftZ(-1);
    }

    /** Base layer relative to the ground line (negative = buried); null if empty. */
    get floorOffset(): number | null {
        if (!this.voxels.length) return null;
        let minZ = Infinity;
        for (const v of this.voxels) if (v.z < minZ) minZ = v.z;
        return minZ - this.ground;
    }

    private ensurePaletteColor(hex: string): void {
        const c = hex.toLowerCase();
        if (this.palette.includes(c)) return;
        const free = this.palette.indexOf(null);
        if (free >= 0) this.palette[free] = c;
    }

    /* ── View toggles ─────────────────────────────────────────── */

    setGridVisible(on: boolean): void {
        this.gridOn = on;
        this.grid.visible = on;
        this.onChange?.();
    }

    setEdgesVisible(on: boolean): void {
        this.edgesOn = on;
        this.rebuildEdges();
        this.onChange?.();
    }

    setGroundGridVisible(on: boolean): void {
        this.groundGridOn = on;
        if (this.groundGridMesh) this.groundGridMesh.visible = on;
        this.onChange?.();
    }

    setWallsVisible(on: boolean): void {
        this.wallsOn = on;
        this.updateWallsForCamera();
        this.onChange?.();
    }

    updateWallsForCamera(): void {
        const { px, nx, pz, nz } = this.wallFaces;
        if (!px || !nx || !pz || !nz) return;
        const { x: cx, z: cz } = this.view.camera.position;
        px.visible = this.wallsOn && cx < 0;
        nx.visible = this.wallsOn && cx > 0;
        pz.visible = this.wallsOn && cz < 0;
        nz.visible = this.wallsOn && cz > 0;
    }

    /** Spread the layers apart vertically (0 = stacked normally). */
    setExplode(amount: number): void {
        const next = Math.max(0, Math.min(8, Math.round(amount)));
        if (next === this.explode) return;
        this.explode = next;
        this.rebuild();
        this.onChange?.();
    }

    raiseExplode(): void {
        this.setExplode(this.explode + 1);
    }

    lowerExplode(): void {
        this.setExplode(this.explode - 1);
    }

    /** Isolate a single z layer (null shows all layers). */
    setFocusLayer(z: number | null): void {
        this.focusLayer = z;
        this.selection.clear();
        this.selectionAnchor = null;
        this.rebuild();
        this.onChange?.();
    }

    /** Step the isolated layer up; from "all" it starts at layer 0. */
    focusUp(): void {
        const z = this.focusLayer == null ? 0 : this.focusLayer + 1;
        this.setFocusLayer(Math.min(z, this.maxZ()));
    }

    /** Step the isolated layer down; stepping below 0 returns to "all". */
    focusDown(): void {
        if (this.focusLayer == null) return;
        this.setFocusLayer(this.focusLayer <= 0 ? null : this.focusLayer - 1);
    }

    clearFocus(): void {
        this.setFocusLayer(null);
    }

    /* ── 90° rotations ───────────────────────────────────────── */

    /**
     * Rotate all voxels 90° clockwise around the vertical (Z) axis when viewed
     * from above. Swaps the footprint width and depth.
     */
    rotateZ(): void {
        if (!this.voxels.length) return;
        this.transact(() => {
            const nx = this.nx;
            for (const v of this.voxels) {
                const ox = v.x, oy = v.y;
                v.x = oy;
                v.y = nx - 1 - ox;
            }
            this.applyFootprint(
                [this.footprint[1], this.footprint[0]],
                this.resolution
            );
            this._clearView();
            this.rebuild();
            this.onChange?.();
        });
    }

    /**
     * Rotate all voxels 90° clockwise around the X axis when viewed from the
     * right side. Old depth (y) becomes height; old height (z) becomes depth.
     * Footprint depth expands to contain the former Z range.
     */
    rotateX(): void {
        if (!this.voxels.length) return;
        this.transact(() => {
            let maxZ = 0;
            for (const v of this.voxels) if (v.z > maxZ) maxZ = v.z;
            const ny = this.ny;
            for (const v of this.voxels) {
                const oy = v.y, oz = v.z;
                v.y = oz;
                v.z = ny - 1 - oy;
            }
            const newD = Math.max(
                1,
                Math.min(8, Math.ceil((maxZ + 1) / this.resolution))
            );
            this.applyFootprint([this.footprint[0], newD], this.resolution);
            this.voxels = this.voxels.filter(v => v.z >= 0 && v.z < this.zCap);
            this._clearView();
            this.rebuild();
            this.onChange?.();
        });
    }

    /**
     * Rotate all voxels 90° clockwise around the Y axis when viewed from the
     * front. Old width (x) becomes height; old height (z) becomes width.
     * Footprint width expands to contain the former Z range.
     */
    rotateY(): void {
        if (!this.voxels.length) return;
        this.transact(() => {
            let maxZ = 0;
            for (const v of this.voxels) if (v.z > maxZ) maxZ = v.z;
            const nx = this.nx;
            for (const v of this.voxels) {
                const ox = v.x, oz = v.z;
                v.x = oz;
                v.z = nx - 1 - ox;
            }
            const newW = Math.max(
                1,
                Math.min(8, Math.ceil((maxZ + 1) / this.resolution))
            );
            this.applyFootprint([newW, this.footprint[1]], this.resolution);
            this.voxels = this.voxels.filter(v => v.z >= 0 && v.z < this.zCap);
            this._clearView();
            this.rebuild();
            this.onChange?.();
        });
    }

    /** Clear transient view state that becomes stale after a rotation. */
    private _clearView(): void {
        this.selection.clear();
        this.selectionAnchor = null;
        this.focusLayer = null;
    }

    /* ── Named layers ─────────────────────────────────────────── */

    /**
     * Assign all currently selected voxels to a new named layer and return its id.
     * The operation is undoable; the selection is preserved.
     */
    captureSelectionAsLayer(name: string): string {
        const id = `layer_${++this._layerCounter}`;
        this.transact(() => {
            this._layers.set(id, {
                id,
                name: name.trim() || 'Layer',
                visible: true
            });
            for (const v of this.voxels) {
                if (this.selection.has(keyOf(v.x, v.y, v.z))) v.layerId = id;
            }
            this.rebuild();
            this.onChange?.();
        });
        return id;
    }

    /** Toggle a layer's visibility. Hidden voxels are excluded from the render and hit-test. */
    setLayerVisible(id: string, visible: boolean): void {
        const layer = this._layers.get(id);
        if (!layer || layer.visible === visible) return;
        layer.visible = visible;
        this.rebuild();
        this.onChange?.();
    }

    /** Rename a layer (not undoable — like renaming a palette slot). */
    renameLayer(id: string, name: string): void {
        const layer = this._layers.get(id);
        const trimmed = name.trim();
        if (!layer || !trimmed || layer.name === trimmed) return;
        layer.name = trimmed;
        this.onChange?.();
    }

    /** Remove the layer; its voxels remain but are no longer layer-assigned. Undoable. */
    deleteLayer(id: string): void {
        if (!this._layers.has(id)) return;
        this.transact(() => {
            this._layers.delete(id);
            for (const v of this.voxels) {
                if (v.layerId === id) v.layerId = null;
            }
            this.rebuild();
            this.onChange?.();
        });
    }

    getLayerVoxelCount(id: string): number {
        return this.voxels.filter(v => v.layerId === id).length;
    }

    private maxZ(): number {
        let mz = 0;
        for (const v of this.voxels) if (v.z > mz) mz = v.z;
        return mz;
    }

    /** Extra world-Y offset applied to a layer in the exploded view. */
    private layerY(z: number): number {
        return z * this.explode * CONFIG.voxel.size;
    }

    /** Voxels currently shown (focus-layer and layer-visibility filters applied). */
    private visibleVoxels(): EditVoxel[] {
        return this.voxels.filter(v => {
            if (this.focusLayer !== null && v.z !== this.focusLayer) return false;
            if (v.layerId) {
                const layer = this._layers.get(v.layerId);
                if (layer && !layer.visible) return false;
            }
            return true;
        });
    }

    clearAll(): void {
        this.transact(() => {
            this.voxels = [];
            this.selection.clear();
            this.selectionAnchor = null;
            this.rebuild();
            this.onChange?.();
        });
    }

    /* ── Undo / redo ──────────────────────────────────────────── */

    private snapshot(): TileSnapshot {
        return {
            voxels: this.voxels.map(v => ({ ...v })),
            palette: [...this.palette],
            layers: [...this._layers.values()].map(l => ({ ...l }))
        };
    }

    /** Drop undo history and any open transaction (a new document is loading). */
    private resetHistory(): void {
        this.history.clear();
        this.txBefore = null;
        this.txKey = null;
        this.lastCommitKey = null;
    }

    /**
     * Run `fn` as one undoable step: snapshot first, record only if the document
     * actually changed. Re-entrant — a call made while a stroke or another
     * transaction is open folds into that outer step instead of recording its own.
     * Pass `coalesceKey` to merge consecutive same-key steps (e.g. dragging a
     * single color slider) into one undo entry.
     */
    private transact<T>(fn: () => T, coalesceKey: string | null = null): T {
        if (this.txBefore) return fn(); // fold into the open transaction
        this.txBefore = this.snapshot();
        this.txKey = coalesceKey;
        try {
            return fn();
        } finally {
            this.commitTx();
        }
    }

    /** Record the open transaction if the document changed, then close it. */
    private commitTx(): void {
        const before = this.txBefore;
        if (!before) return;
        const key = this.txKey;
        this.txBefore = null;
        this.txKey = null;
        if (!this.documentChanged(before)) return;
        // A run of same-key edits keeps the first step's "before" on the stack.
        if (key != null && key === this.lastCommitKey) {
            this.onChange?.();
            return;
        }
        this.history.record(before);
        this.lastCommitKey = key;
        this.onChange?.();
    }

    private documentChanged(before: TileSnapshot): boolean {
        if (this.voxels.length !== before.voxels.length) return true;
        for (let i = 0; i < this.voxels.length; i++) {
            const a = this.voxels[i]!;
            const b = before.voxels[i]!;
            if (
                a.x !== b.x ||
                a.y !== b.y ||
                a.z !== b.z ||
                a.ci !== b.ci ||
                a.layerId !== b.layerId
            ) {
                return true;
            }
        }
        if (this.palette.length !== before.palette.length) return true;
        for (let i = 0; i < this.palette.length; i++) {
            if (this.palette[i] !== before.palette[i]) return true;
        }
        if (this._layers.size !== before.layers.length) return true;
        for (const bl of before.layers) {
            const l = this._layers.get(bl.id);
            if (!l || l.name !== bl.name) return true;
        }
        return false;
    }

    private restore(snap: TileSnapshot): void {
        this.voxels = snap.voxels.map(v => ({ ...v }));
        this.palette = [...snap.palette];
        this._layers = new Map(snap.layers.map(l => [l.id, { ...l }]));
        if (this.palette[this.activeColorIdx] == null) {
            const first = this.palette.findIndex(c => c != null);
            this.activeColorIdx = first >= 0 ? first : 0;
        }
        this.lastCommitKey = null;
        this.rebuild(); // rebuildSelection prunes keys whose voxel is now gone
        this.onChange?.();
    }

    /**
     * Record the current state as a save milestone in the undo stack. Navigating
     * through it with undo/redo works like any other step; the milestone flag lets
     * the UI label the buttons ("Undo ✦" / "Redo ✦").
     */
    recordSave(): void {
        this.history.milestone(this.snapshot());
        this.onChange?.();
    }

    undo(): void {
        const prev = this.history.undo(this.snapshot());
        if (prev) this.restore(prev);
    }

    redo(): void {
        const next = this.history.redo(this.snapshot());
        if (next) this.restore(next);
    }

    get canUndo(): boolean {
        return this.history.canUndo;
    }

    get canRedo(): boolean {
        return this.history.canRedo;
    }

    get nextUndoIsMilestone(): boolean {
        return this.history.nextUndoIsMilestone;
    }

    get nextRedoIsMilestone(): boolean {
        return this.history.nextRedoIsMilestone;
    }

    /* ── Editing via raycast ──────────────────────────────────── */

    /** Open an undoable stroke: reset drag-dedup and snapshot the pre-edit state. */
    beginStroke(): void {
        this.lastTargetKey = null;
        this.commitTx(); // flush a stroke interrupted before its endStroke
        this.txBefore = this.snapshot();
        this.txKey = null;
    }

    /** Close the stroke opened by {@link beginStroke}, recording it if it changed. */
    endStroke(): void {
        this.commitTx();
    }

    /**
     * Apply the active tool at a screen pixel. `remove` (modifier held) flips the
     * Select tool to deselect. `toolOverride` runs a different tool for this call
     * only — used by right-click to invert the sculpt tool (Add↔Delete) without
     * changing the active selection. Returns true if anything changed.
     */
    editAt(
        clientX: number,
        clientY: number,
        remove = false,
        extend = false,
        toolOverride?: EditTool
    ): boolean {
        const tool = toolOverride ?? this.tool;
        const ndc = this.toNdc(clientX, clientY);
        this.raycaster.layers.set(1);
        this.raycaster.setFromCamera(ndc, this.view.camera);
        const hit = this.hitMesh
            ? this.raycaster.intersectObject(this.hitMesh, false)[0]
            : undefined;

        if (!hit || hit.instanceId == null) {
            // No voxel under the cursor: only "add" works, dropping onto the floor.
            if (tool !== 'add') return false;
            const cell = this.floorCell(ndc);
            if (!cell || !this.claimTarget(keyOf(cell.x, cell.y, cell.z))) {
                return false;
            }
            return this.addVoxel(cell.x, cell.y, cell.z);
        }

        const v = this.hitVoxels[hit.instanceId];
        if (!v) return false;
        const here = keyOf(v.x, v.y, v.z);

        switch (tool) {
            case 'add': {
                const n = hit.face!.normal;
                const tx = v.x + Math.round(n.x);
                const ty = v.y + Math.round(n.z);
                const tz = v.z + Math.round(n.y);
                if (!this.claimTarget(keyOf(tx, ty, tz))) return false;
                return this.addVoxel(tx, ty, tz);
            }
            case 'delete':
                if (!this.claimTarget(here)) return false;
                if (this.selection.size > 0) this.applyToSelection('delete');
                else this.removeAt(here);
                return true;
            case 'paint':
                if (!this.claimTarget(here)) return false;
                if (this.selection.size > 0) this.applyToSelection('paint');
                else this.paintAt(here);
                return true;
            case 'select': {
                if (!this.claimTarget(here)) return false;
                if (extend && this.selectionAnchor != null) {
                    // Shift+click: range add/remove from anchor (Alt = remove)
                    this.selectPlanarRange(this.selectionAnchor, v, hit.face!.normal, remove);
                } else if (remove) {
                    // Alt+click (no range): deselect the single voxel
                    this.selection.delete(here);
                    this.selectionAnchor = null;
                } else {
                    // Normal click (or Shift with no anchor): add + set anchor
                    this.selection.add(here);
                    this.selectionAnchor = { x: v.x, y: v.y, z: v.z };
                }
                this.rebuildSelection();
                this.onChange?.();
                return true;
            }
            case 'face-select': {
                if (!this.claimTarget(here)) return false;
                this.selectFaceFloodFill(v, hit.face!.normal, remove);
                this.rebuildSelection();
                this.onChange?.();
                return true;
            }
            case 'eyedropper':
                this.selectColorIdx(v.ci);
                return true;
        }
    }

    /** Dedup guard: false if this target was already acted on this stroke. */
    private claimTarget(key: string): boolean {
        if (key === this.lastTargetKey) return false;
        this.lastTargetKey = key;
        return true;
    }

    private applyToSelection(op: 'delete' | 'paint'): void {
        if (op === 'delete') {
            this.voxels = this.voxels.filter(
                v => !this.selection.has(keyOf(v.x, v.y, v.z))
            );
        } else {
            for (const v of this.voxels) {
                if (this.selection.has(keyOf(v.x, v.y, v.z)))
                    v.ci = this.activeColorIdx;
            }
        }
        this.selection.clear();
        this.selectionAnchor = null;
        this.rebuild();
        this.onChange?.();
    }

    /**
     * Add all visible voxels within the bounding rectangle between `anchor` and
     * `target` on the plane determined by `faceNormal` to the selection.
     * THREE.y maps to voxel-z (vertical); THREE.z maps to voxel-y (depth).
     */
    private selectPlanarRange(
        anchor: { x: number; y: number; z: number },
        target: EditVoxel,
        faceNormal: THREE.Vector3,
        deselect = false
    ): void {
        const fny = Math.round(faceNormal.y);
        const fnx = Math.round(faceNormal.x);
        const toggle = (v: EditVoxel) => {
            const k = keyOf(v.x, v.y, v.z);
            if (deselect) this.selection.delete(k);
            else this.selection.add(k);
        };
        for (const v of this.visibleVoxels()) {
            if (fny !== 0) {
                if (
                    v.z === target.z &&
                    v.x >= Math.min(anchor.x, target.x) &&
                    v.x <= Math.max(anchor.x, target.x) &&
                    v.y >= Math.min(anchor.y, target.y) &&
                    v.y <= Math.max(anchor.y, target.y)
                ) toggle(v);
            } else if (fnx !== 0) {
                if (
                    v.x === target.x &&
                    v.y >= Math.min(anchor.y, target.y) &&
                    v.y <= Math.max(anchor.y, target.y) &&
                    v.z >= Math.min(anchor.z, target.z) &&
                    v.z <= Math.max(anchor.z, target.z)
                ) toggle(v);
            } else {
                if (
                    v.y === target.y &&
                    v.x >= Math.min(anchor.x, target.x) &&
                    v.x <= Math.max(anchor.x, target.x) &&
                    v.z >= Math.min(anchor.z, target.z) &&
                    v.z <= Math.max(anchor.z, target.z)
                ) toggle(v);
            }
        }
    }

    /**
     * BFS flood-fill: starting at `voxel`, add all contiguous visible voxels of
     * the same color that lie on the same plane (defined by `faceNormal`) to the
     * selection. Stops at color boundaries.
     */
    private selectFaceFloodFill(
        voxel: EditVoxel,
        faceNormal: THREE.Vector3,
        deselect = false
    ): void {
        const fny = Math.round(faceNormal.y);
        const fnx = Math.round(faceNormal.x);
        // 4-connected neighbor offsets on the plane (THREE.y=voxelZ, THREE.z=voxelY).
        const deltas: [number, number, number][] =
            fny !== 0
                ? [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]  // horizontal
                : fnx !== 0
                    ? [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] // X-slice
                    : [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]; // Y-slice

        const targetCi = voxel.ci;
        const voxelMap = new Map<string, EditVoxel>();
        for (const v of this.visibleVoxels()) voxelMap.set(keyOf(v.x, v.y, v.z), v);

        const visited = new Set<string>();
        const queue: EditVoxel[] = [voxel];
        while (queue.length > 0) {
            const cur = queue.shift()!;
            const key = keyOf(cur.x, cur.y, cur.z);
            if (visited.has(key)) continue;
            visited.add(key);
            if (cur.ci !== targetCi) continue;
            if (deselect) this.selection.delete(key);
            else this.selection.add(key);
            for (const [dx, dy, dz] of deltas) {
                const nk = keyOf(cur.x + dx, cur.y + dy, cur.z + dz);
                if (!visited.has(nk)) {
                    const nv = voxelMap.get(nk);
                    if (nv) queue.push(nv);
                }
            }
        }
    }

    private removeAt(key: string): void {
        this.voxels = this.voxels.filter(v => keyOf(v.x, v.y, v.z) !== key);
        this.rebuild();
        this.onChange?.();
    }

    private paintAt(key: string): void {
        for (const v of this.voxels) {
            if (keyOf(v.x, v.y, v.z) === key) v.ci = this.activeColorIdx;
        }
        this.rebuild();
        this.onChange?.();
    }

    private floorCell(
        ndc: THREE.Vector2
    ): { x: number; y: number; z: number } | null {
        this.raycaster.layers.set(0); // hit the ground, not the hitbox layer
        this.raycaster.setFromCamera(ndc, this.view.camera);
        const p = new THREE.Vector3();
        const ok = this.raycaster.ray.intersectPlane(this.floorPlane, p);
        this.raycaster.layers.set(1);
        if (!ok) return null;
        const x = Math.floor(p.x + this.halfX);
        const y = Math.floor(p.z + this.halfY);
        if (x < 0 || y < 0 || x >= this.nx || y >= this.ny) return null;
        return { x, y, z: 0 };
    }

    private addVoxel(x: number, y: number, z: number): boolean {
        if (
            x < 0 ||
            y < 0 ||
            x >= this.nx ||
            y >= this.ny ||
            z < 0 ||
            z >= this.zCap
        )
            return false;
        if (this.occupied().has(keyOf(x, y, z))) return false;
        this.voxels.push({ x, y, z, ci: this.activeColorIdx });
        this.rebuild();
        this.onChange?.();
        return true;
    }

    /* ── Rendering ────────────────────────────────────────────── */

    private rebuild(): void {
        this.disposeDisplay();
        const visible = this.visibleVoxels();
        if (visible.length && this.explode === 0) {
            const batch = new VoxelBatch(CONFIG.voxel.size);
            batch.add(this.materialize(visible), {
                origin: [-this.halfX, 0, -this.halfY]
            });
            this.display.add(batch.build());
        } else if (visible.length) {
            // Exploded: one batch per layer, lifted by the per-layer gap.
            const byLayer = new Map<number, EditVoxel[]>();
            for (const v of visible) {
                let arr = byLayer.get(v.z);
                if (!arr) {
                    arr = [];
                    byLayer.set(v.z, arr);
                }
                arr.push(v);
            }
            for (const [z, vs] of byLayer) {
                const batch = new VoxelBatch(CONFIG.voxel.size);
                batch.add(this.materialize(vs), {
                    origin: [-this.halfX, this.layerY(z), -this.halfY]
                });
                this.display.add(batch.build());
            }
        }
        this.rebuildHitMesh();
        this.rebuildSelection();
        this.rebuildEdges();
        this.view.scene.updateMatrixWorld(true);
    }

    /** Rebuild the per-voxel cube-edge overlay (only when the toggle is on). */
    private rebuildEdges(): void {
        if (this.edges) {
            this.root.remove(this.edges);
            this.edges.geometry.dispose();
            this.edges = null;
        }
        const visible = this.visibleVoxels();
        if (!this.edgesOn || !visible.length) return;
        const tpl = this.edgeTemplate;
        const stride = tpl.length; // 72 = 24 verts × 3
        const arr = new Float32Array(visible.length * stride);
        for (let i = 0; i < visible.length; i++) {
            const v = visible[i]!;
            const ox = v.x + 0.5 - this.halfX;
            const oy = v.z + 0.5 + this.layerY(v.z);
            const oz = v.y + 0.5 - this.halfY;
            const o = i * stride;
            for (let j = 0; j < stride; j += 3) {
                arr[o + j] = tpl[j]! + ox;
                arr[o + j + 1] = tpl[j + 1]! + oy;
                arr[o + j + 2] = tpl[j + 2]! + oz;
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        this.edges = new THREE.LineSegments(geo, this.edgeMat);
        this.root.add(this.edges);
    }

    private rebuildHitMesh(): void {
        if (this.hitMesh) {
            this.root.remove(this.hitMesh);
            this.hitMesh = null;
        }
        // Only the visible voxels are pickable; keep them in instance order so
        // editAt can map a hit's instanceId back to a voxel.
        this.hitVoxels = this.visibleVoxels();
        if (!this.hitVoxels.length) return;
        const mesh = new THREE.InstancedMesh(
            this.hitGeo,
            this.hitMat,
            this.hitVoxels.length
        );
        mesh.layers.set(1); // raycast-only; camera renders layer 0
        const m = new THREE.Matrix4();
        for (let i = 0; i < this.hitVoxels.length; i++) {
            const v = this.hitVoxels[i]!;
            m.setPosition(
                v.x + 0.5 - this.halfX,
                v.z + 0.5 + this.layerY(v.z),
                v.y + 0.5 - this.halfY
            );
            mesh.setMatrixAt(i, m);
        }
        mesh.instanceMatrix.needsUpdate = true;
        this.hitMesh = mesh;
        this.root.add(mesh);
    }

    private rebuildSelection(): void {
        if (this.selectionMesh) {
            this.root.remove(this.selectionMesh);
            this.selectionMesh = null;
        }
        // Drop selected keys whose voxel no longer exists.
        const occ = this.occupied();
        for (const k of [...this.selection]) {
            if (!occ.has(k)) this.selection.delete(k);
        }
        // Only highlight selected voxels that are currently visible (focus + layer filters).
        const visibleKeySet = new Set(
            this.visibleVoxels().map(v => keyOf(v.x, v.y, v.z))
        );
        const visKeys = [...this.selection].filter(k => visibleKeySet.has(k));
        if (visKeys.length === 0) return;

        const mesh = new THREE.InstancedMesh(
            this.selGeo,
            this.selMat,
            visKeys.length
        );
        const m = new THREE.Matrix4();
        let i = 0;
        for (const k of visKeys) {
            const [x, y, z] = k.split(',').map(Number) as [
                number,
                number,
                number
            ];
            m.setPosition(
                x + 0.5 - this.halfX,
                z + 0.5 + this.layerY(z),
                y + 0.5 - this.halfY
            );
            mesh.setMatrixAt(i++, m);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.visible = !this.selectionPeek;
        this.selectionMesh = mesh;
        this.root.add(mesh);
    }

    /**
     * (Re)build the floor grid + datum plane for the current footprint. Safe to
     * call again after {@link setFootprint} resizes the author grid.
     */
    private buildFloor(): void {
        const hx = this.halfX;
        const hy = this.halfY;

        if (this.grid) {
            this.root.remove(this.grid);
            this.disposeGridGroup(this.grid);
        }
        this.grid = this.buildFlatGridGroup(0, 0x9c8f6e, 0.7, 0.25);
        this.grid.visible = this.gridOn;
        this.root.add(this.grid);

        if (this.datum) {
            this.root.remove(this.datum);
            this.datum.traverse(o => {
                const mesh = o as Partial<THREE.Mesh>;
                mesh.geometry?.dispose();
            });
        }
        // Datum: the fixed plane that meets scene ground (z = ground). Voxels
        // below it are buried when placed; the Floor tool shifts the model
        // relative to this line. The fill extends far outward but is hollowed
        // over the footprint so it doesn't clip through tiles inside it.
        const outerHalf = 500;
        const shape = new THREE.Shape();
        shape.moveTo(-outerHalf, -outerHalf);
        shape.lineTo(outerHalf, -outerHalf);
        shape.lineTo(outerHalf, outerHalf);
        shape.lineTo(-outerHalf, outerHalf);
        shape.closePath();
        const hole = new THREE.Path();
        hole.moveTo(-hx, -hy);
        hole.lineTo(-hx, hy);
        hole.lineTo(hx, hy);
        hole.lineTo(hx, -hy);
        hole.closePath();
        shape.holes.push(hole);
        const fillGeo = new THREE.ShapeGeometry(shape);
        fillGeo.rotateX(-Math.PI / 2);

        const borderCorners = [
            new THREE.Vector3(-hx, 0, -hy),
            new THREE.Vector3(hx, 0, -hy),
            new THREE.Vector3(hx, 0, hy),
            new THREE.Vector3(-hx, 0, hy)
        ];
        const borderGeo = new THREE.BufferGeometry().setFromPoints(
            borderCorners
        );

        const datum = new THREE.Group();
        datum.add(
            new THREE.Mesh(
                fillGeo,
                new THREE.MeshBasicMaterial({
                    color: 0x1b5ba8,
                    transparent: true,
                    opacity: 0.12,
                    depthWrite: false
                })
            ),
            new THREE.LineLoop(
                borderGeo,
                new THREE.LineBasicMaterial({
                    color: 0x1b5ba8,
                    opacity: 0.5,
                    transparent: true
                })
            )
        );
        datum.position.y = this.ground * CONFIG.voxel.size;
        this.datum = datum;
        this.root.add(datum);

        this.buildGroundGrid();
        this.buildWalls();
    }

    private buildGroundGrid(): void {
        if (this.groundGridMesh) {
            this.root.remove(this.groundGridMesh);
            this.disposeGridGroup(this.groundGridMesh);
            this.groundGridMesh = null;
        }
        const yg = this.ground * CONFIG.voxel.size;
        this.groundGridMesh = this.buildFlatGridGroup(yg, 0x4a7fb5, 0.65, 0.2);
        this.groundGridMesh.visible = this.groundGridOn;
        this.root.add(this.groundGridMesh);
    }

    private buildWalls(): void {
        if (this.wallsGroup) {
            this.root.remove(this.wallsGroup);
            this.wallsGroup = null;
        }
        for (const key of ['px', 'nx', 'pz', 'nz'] as const) {
            this.disposeGridGroup(this.wallFaces[key]);
            this.wallFaces[key] = null;
        }

        const hx = this.halfX;
        const hy = this.halfY;

        this.wallFaces.nx = this.buildWallFaceGroup('x', -hx, -hy, hy, this.ny);
        this.wallFaces.px = this.buildWallFaceGroup('x',  hx, -hy, hy, this.ny);
        this.wallFaces.nz = this.buildWallFaceGroup('z', -hy, -hx, hx, this.nx);
        this.wallFaces.pz = this.buildWallFaceGroup('z',  hy, -hx, hx, this.nx);

        const group = new THREE.Group();
        group.add(this.wallFaces.nx!, this.wallFaces.px!, this.wallFaces.nz!, this.wallFaces.pz!);
        this.wallsGroup = group;
        this.root.add(group);
        this.updateWallsForCamera();
    }

    /** Build a Group with two LineSegments children: major (world-cell boundaries) and minor. */
    private makeLinesGroup(
        major: number[],
        minor: number[],
        color: number,
        majorOpacity: number,
        minorOpacity: number
    ): THREE.Group {
        const group = new THREE.Group();
        if (major.length) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(major, 3));
            group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: majorOpacity })));
        }
        if (minor.length) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(minor, 3));
            group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: minorOpacity })));
        }
        return group;
    }

    private disposeGridGroup(group: THREE.Group | null): void {
        if (!group) return;
        group.traverse(o => {
            const ls = o as THREE.LineSegments;
            if (ls.isLineSegments) {
                ls.geometry.dispose();
                (ls.material as THREE.Material).dispose();
            }
        });
    }

    /**
     * Flat (horizontal) grid at world y=`yPos`. Lines at base-12-aligned voxel
     * positions are darker; sub-cell lines are lighter.
     */
    private buildFlatGridGroup(yPos: number, color: number, majorOpacity: number, minorOpacity: number): THREE.Group {
        const hx = this.halfX;
        const hy = this.halfY;
        const step = this.resolution / PER_TILE; // base-12 interval in voxels
        const major: number[] = [];
        const minor: number[] = [];
        for (let i = 0; i <= this.nx; i++) {
            const x = i - hx;
            (i % step === 0 ? major : minor).push(x, yPos, -hy, x, yPos, hy);
        }
        for (let j = 0; j <= this.ny; j++) {
            const z = j - hy;
            (j % step === 0 ? major : minor).push(-hx, yPos, z, hx, yPos, z);
        }
        return this.makeLinesGroup(major, minor, color, majorOpacity, minorOpacity);
    }

    /**
     * One wall face of the tile bounding box. `fixedAxis` is the axis held
     * constant; `fixedVal` is that coordinate; `rangeMin/Max` are the span along
     * the perpendicular axis; `nRange` is the voxel count along that axis.
     * Horizontal lines (one per layer) and vertical lines (one per column) are
     * colour-weighted by the base-12 step.
     */
    private buildWallFaceGroup(
        fixedAxis: 'x' | 'z',
        fixedVal: number,
        rangeMin: number,
        rangeMax: number,
        nRange: number
    ): THREE.Group {
        const top = this.zCap * CONFIG.voxel.size;
        const vs = CONFIG.voxel.size;
        const step = this.resolution / PER_TILE;
        const color = 0x7a6d5c;
        const major: number[] = [];
        const minor: number[] = [];
        const v = fixedVal;

        if (fixedAxis === 'x') {
            // Outline (always major)
            major.push(v, 0,   rangeMin,  v, 0,   rangeMax);
            major.push(v, top, rangeMin,  v, top,  rangeMax);
            major.push(v, 0,   rangeMin,  v, top,  rangeMin);
            major.push(v, 0,   rangeMax,  v, top,  rangeMax);
            // Horizontal lines at each voxel layer
            for (let z = 1; z < this.zCap; z++) {
                const y = z * vs;
                (z % step === 0 ? major : minor).push(v, y, rangeMin, v, y, rangeMax);
            }
            // Vertical lines along the range axis
            for (let j = 1; j < nRange; j++) {
                const r = rangeMin + j;
                (j % step === 0 ? major : minor).push(v, 0, r, v, top, r);
            }
        } else {
            // Outline (always major)
            major.push(rangeMin, 0,   v,  rangeMax, 0,   v);
            major.push(rangeMin, top, v,  rangeMax, top, v);
            major.push(rangeMin, 0,   v,  rangeMin, top, v);
            major.push(rangeMax, 0,   v,  rangeMax, top, v);
            // Horizontal lines at each voxel layer
            for (let z = 1; z < this.zCap; z++) {
                const y = z * vs;
                (z % step === 0 ? major : minor).push(rangeMin, y, v, rangeMax, y, v);
            }
            // Vertical lines along the range axis
            for (let i = 1; i < nRange; i++) {
                const r = rangeMin + i;
                (i % step === 0 ? major : minor).push(r, 0, v, r, top, v);
            }
        }

        return this.makeLinesGroup(major, minor, color, 0.45, 0.15);
    }

    private occupied(): Set<string> {
        return new Set(this.voxels.map(v => keyOf(v.x, v.y, v.z)));
    }

    private toNdc(clientX: number, clientY: number): THREE.Vector2 {
        const rect = this.view.renderer.domElement.getBoundingClientRect();
        return new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1
        );
    }

    private disposeDisplay(): void {
        for (const child of [...this.display.children]) {
            this.display.remove(child);
            child.traverse(o => {
                const mesh = o as Partial<THREE.Mesh>;
                mesh.geometry?.dispose();
                const mat = mesh.material;
                if (Array.isArray(mat)) mat.forEach(x => x.dispose());
                else mat?.dispose();
            });
        }
    }
}

function keyOf(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
}

function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
    const h = (v: number) => v.toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
}

function clamp8(v: number): number {
    return Math.max(0, Math.min(255, Math.round(v)));
}

/** Perceived lightness (Rec. 601 luma), 0–255. */
function hexLuma(hex: string): number {
    const [r, g, b] = hexToRgb(hex);
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Hue angle in degrees (0–360); greys sort first (returns -1). */
function hexHue(hex: string): number {
    const [r, g, b] = hexToRgb(hex).map(v => v / 255);
    const max = Math.max(r!, g!, b!);
    const min = Math.min(r!, g!, b!);
    const d = max - min;
    if (d === 0) return -1;
    let h: number;
    if (max === r) h = ((g! - b!) / d) % 6;
    else if (max === g) h = (b! - r!) / d + 2;
    else h = (r! - g!) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
}

/** Hex → HSL: hue 0–360, saturation/lightness 0–1. */
export function hexToHsl(hex: string): [number, number, number] {
    const [r, g, b] = hexToRgb(hex).map(v => v / 255) as [
        number,
        number,
        number
    ];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const l = (max + min) / 2;
    if (d === 0) return [0, 0, l];
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h: number;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return [h < 0 ? h + 360 : h, s, l];
}

/** HSL (hue any degrees, s/l 0–1) → hex. */
export function hslToHex(h: number, s: number, l: number): string {
    const hue = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;
    if (hue < 60) [r, g] = [c, x];
    else if (hue < 120) [r, g] = [x, c];
    else if (hue < 180) [g, b] = [c, x];
    else if (hue < 240) [g, b] = [x, c];
    else if (hue < 300) [r, b] = [x, c];
    else [r, b] = [c, x];
    return rgbToHex([
        clamp8((r + m) * 255),
        clamp8((g + m) * 255),
        clamp8((b + m) * 255)
    ]);
}

/** Standard-normal sample (Box–Muller). */
function gaussian(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
