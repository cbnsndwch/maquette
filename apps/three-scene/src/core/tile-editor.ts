import * as THREE from "three";

import { decodeVox, VoxelBatch, type Voxel } from "@cbnsndwch/world-core";

import { CONFIG } from "../config.js";
import type { SceneView } from "./scene-view.js";

const N = CONFIG.voxel.perTile; // 12 — footprint edge in voxels
const HALF = N / 2;
const GROUND = CONFIG.groundLayers; // scene ground line; lower layers are buried
/** Fixed palette size — an 8×32 grid, matching the importable palette image. */
const PALETTE_SIZE = 256;
/** Discrete shade levels the Shade tool quantizes a color to. */
const SHADE_STEPS = 7;
/** Rendered for a voxel whose palette slot was cleared/unassigned (flags the orphan). */
const FALLBACK_COLOR = "#ff00ff";

export type EditTool = "add" | "delete" | "paint" | "eyedropper" | "select";

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
}

const DEFAULT_PALETTE = [
    "#fafaf5",
    "#cdc8b8",
    "#b5b0a2",
    "#8d8878",
    "#e8d4a8",
    "#c4622e",
    "#7eaa5f",
    "#5c8a44",
    "#7a9460",
    "#a07344",
    "#1b5ba8",
    "#3a3833",
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
    /** Fixed 256-slot palette; null = unassigned (shown as an empty swatch). */
    palette: (string | null)[] = makeDefaultPalette();
    activeColorIdx = 0;
    tool: EditTool = "add";
    /** Selected voxel position keys ("x,y,z"). */
    readonly selection = new Set<string>();
    /** Id of the tile being edited (set by {@link loadTile}); null for a new tile. */
    editingId: string | null = null;
    gridOn = true;
    edgesOn = false;
    /** Exploded view: extra vertical gap (in voxels) inserted between layers. */
    explode = 0;
    /** When set, only this z layer is shown (isolate a layer); null = all. */
    focusLayer: number | null = null;

    private readonly root = new THREE.Group();
    private readonly display = new THREE.Group();
    private hitMesh: THREE.InstancedMesh | null = null;
    /** Voxels backing the hit mesh, in instance order (the visible subset). */
    private hitVoxels: EditVoxel[] = [];
    private selectionMesh: THREE.InstancedMesh | null = null;
    private edges: THREE.LineSegments | null = null;
    private grid!: THREE.GridHelper;
    private readonly hitGeo = new THREE.BoxGeometry(1, 1, 1);
    private readonly hitMat = new THREE.MeshBasicMaterial();
    private readonly selGeo = new THREE.BoxGeometry(1.12, 1.12, 1.12);
    private readonly selMat = new THREE.MeshBasicMaterial({
        color: 0xffcf3a,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
    });
    /** Unit-cube edge vertices (24, as 12 line segments) replicated per voxel. */
    private readonly edgeTemplate = new THREE.EdgesGeometry(
        this.hitGeo
    ).getAttribute("position").array as Float32Array;
    private readonly edgeMat = new THREE.LineBasicMaterial({
        color: 0x2a2a2a,
        transparent: true,
        opacity: 0.35,
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

    constructor(private readonly view: SceneView) {
        this.raycaster.layers.set(1);
        this.root.visible = false;
        this.root.add(this.display);
        this.buildFloor();
        this.view.scene.add(this.root);
    }

    get activeColor(): string {
        return this.palette[this.activeColorIdx] ?? "#ffffff";
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
        this.tool = "add";
        this.editingId = null;
        this.explode = 0;
        this.focusLayer = null;
        this.selection.clear();
        this.rebuild();
        this.onChange?.();
    }

    /**
     * Load an existing tile's voxels + saved palette for editing.
     * {@link editingId} is set so a save overwrites the same tile.
     */
    loadTile(
        voxels: readonly Voxel[],
        id: string,
        palette?: readonly (string | null)[]
    ): void {
        this.load(voxels, palette, id);
    }

    /**
     * Load voxels + palette from an imported `.vox` as a *new* tile (no
     * {@link editingId}), so saving creates a fresh catalog entry.
     */
    loadExternal(
        voxels: readonly Voxel[],
        palette?: readonly (string | null)[]
    ): void {
        this.load(voxels, palette, null);
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
        id: string | null
    ): void {
        const hexes = voxels.map((v) => v.c.toLowerCase());
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
        const first = this.palette.findIndex((c) => c != null);
        this.activeColorIdx = first >= 0 ? first : 0;
        this.tool = "add";
        this.editingId = id;
        this.explode = 0;
        this.focusLayer = null;
        this.selection.clear();
        this.rebuild();
        this.onChange?.();
    }

    /** Use the saved palette when present; otherwise derive from voxel colors. */
    private resolvePalette(
        hexes: readonly string[],
        palette?: readonly (string | null)[]
    ): (string | null)[] {
        if (palette && palette.some((c) => c != null)) return toSlots(palette);
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
        return voxels.map((v) => ({
            x: v.x,
            y: v.y,
            z: v.z,
            c: this.palette[v.ci] ?? FALLBACK_COLOR,
        }));
    }

    /** True if any voxel is colored by palette slot `i`. */
    slotInUse(i: number): boolean {
        return this.voxels.some((v) => v.ci === i);
    }

    setTool(t: EditTool): void {
        this.tool = t;
        this.onChange?.();
    }

    /** Make `hex` the active color, assigning it to its slot (or the first free one). */
    setColor(hex: string): void {
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
    }

    /**
     * Assign a color to a specific palette slot (from the swatch popover). Voxels
     * reference slots by index, so this live-recolors every voxel using slot `i`.
     */
    setSlotColor(i: number, hex: string): void {
        if (i < 0 || i >= PALETTE_SIZE) return;
        this.palette[i] = hex.toLowerCase();
        this.activeColorIdx = i;
        this.rebuild();
        this.onChange?.();
    }

    /** Unassign a palette slot. Refuses while a voxel still uses it (would orphan). */
    clearSlot(i: number): void {
        if (i < 0 || i >= PALETTE_SIZE || this.palette[i] == null) return;
        if (this.slotInUse(i)) return;
        this.palette[i] = null;
        if (this.activeColorIdx === i) {
            const next = this.palette.findIndex((c) => c != null);
            this.activeColorIdx = next >= 0 ? next : 0;
        }
        this.onChange?.();
    }

    /**
     * Replace the whole palette (e.g. imported from an image, or a saved library
     * palette). Voxels keep their slot index, so they recolor against the new
     * palette; any voxel whose slot is now unassigned renders {@link FALLBACK_COLOR}.
     */
    setPalette(colors: readonly (string | null)[]): void {
        this.palette = toSlots(colors);
        const first = this.palette.findIndex((c) => c != null);
        this.activeColorIdx = first >= 0 ? first : 0;
        this.rebuild();
        this.onChange?.();
    }

    /**
     * Permute the palette so the new slot `i` holds old slot `order[i]`, remapping
     * every voxel's index so colors stay attached (the model is visually
     * unchanged). `order` must be a permutation of 0…{@link PALETTE_SIZE}-1.
     */
    reorderPalette(order: readonly number[]): void {
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
    }

    /** Sort assigned colors (by hue or lightness) to the front; empties trail. */
    sortPalette(key: "hue" | "light"): void {
        const assigned: number[] = [];
        const empty: number[] = [];
        for (let i = 0; i < this.palette.length; i++) {
            if (this.palette[i] != null) assigned.push(i);
            else empty.push(i);
        }
        const metric = key === "hue" ? hexHue : hexLuma;
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
        return this.addColors(out);
    }

    /**
     * Add harmony colors derived from the active color (same S/L, rotated hue):
     * complement (+180°), analogous (±30°), or triad (±120°). Returns false if
     * there aren't enough free slots.
     */
    harmony(kind: "complement" | "analogous" | "triad"): boolean {
        const [h, s, l] = hexToHsl(this.activeColor);
        const offsets =
            kind === "complement"
                ? [180]
                : kind === "analogous"
                  ? [30, -30]
                  : [120, -120];
        return this.addColors(offsets.map((d) => hslToHex(h + d, s, l)));
    }

    /** Add the distinct, not-yet-present colors to free slots; false if no room. */
    private addColors(colors: readonly string[]): boolean {
        const distinct = [...new Set(colors.map((c) => c.toLowerCase()))].filter(
            (c) => !this.palette.includes(c)
        );
        if (distinct.length > this.freeSlotCount()) return false;
        for (const c of distinct) this.ensurePaletteColor(c);
        if (distinct.length) this.onChange?.();
        return true;
    }

    selectColorIdx(i: number): void {
        if (i >= 0 && i < PALETTE_SIZE && this.palette[i] != null) {
            this.activeColorIdx = i;
            this.onChange?.();
        }
    }

    clearSelection(): void {
        if (this.selection.size === 0) return;
        this.selection.clear();
        this.rebuildSelection();
        this.onChange?.();
    }

    /* ── Selection-set operations (context menu) ──────────────────── */

    /** Remove every selected voxel. */
    deleteSelection(): void {
        if (this.selection.size === 0) return;
        this.voxels = this.voxels.filter(
            (v) => !this.selection.has(keyOf(v.x, v.y, v.z))
        );
        this.selection.clear();
        this.rebuild();
        this.onChange?.();
    }

    /** Recolor every selected voxel; the selection stays so it can be reused. */
    recolorSelection(hex: string): void {
        if (this.selection.size === 0) return;
        this.setColor(hex); // ensure it's in the palette + active
        const ci = this.activeColorIdx;
        for (const v of this.voxels) {
            if (this.selection.has(keyOf(v.x, v.y, v.z))) v.ci = ci;
        }
        this.rebuild();
        this.onChange?.();
    }

    /**
     * Translate the selection by `(dx, dy, dz)` voxels, carrying the selection
     * with it. Aborts (returns false, no change) if any voxel would leave the
     * grid or collide with an unselected voxel.
     */
    moveSelection(dx: number, dy: number, dz: number): boolean {
        if (this.selection.size === 0) return false;
        const fixed = new Set<string>();
        for (const v of this.voxels) {
            const k = keyOf(v.x, v.y, v.z);
            if (!this.selection.has(k)) fixed.add(k);
        }
        const moves: { v: EditVoxel; nx: number; ny: number; nz: number }[] = [];
        for (const v of this.voxels) {
            if (!this.selection.has(keyOf(v.x, v.y, v.z))) continue;
            const nx = v.x + dx;
            const ny = v.y + dy;
            const nz = v.z + dz;
            if (nx < 0 || ny < 0 || nx >= N || ny >= N || nz < 0 || nz >= 64) {
                return false;
            }
            if (fixed.has(keyOf(nx, ny, nz))) return false;
            moves.push({ v, nx, ny, nz });
        }
        this.selection.clear();
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

    /** Fill the buried base layers (z 0..GROUND-1) with the active color. */
    fillBase(): void {
        const occ = this.occupied();
        for (let z = 0; z < GROUND; z++) {
            for (let y = 0; y < N; y++) {
                for (let x = 0; x < N; x++) {
                    if (!occ.has(keyOf(x, y, z))) {
                        this.voxels.push({ x, y, z, ci: this.activeColorIdx });
                    }
                }
            }
        }
        this.rebuild();
        this.onChange?.();
    }

    /** Remove the buried base layers (z < GROUND). */
    clearBase(): void {
        this.voxels = this.voxels.filter((v) => v.z >= GROUND);
        this.rebuild();
        this.onChange?.();
    }

    /** Remove everything above ground (z >= GROUND). */
    clearTop(): void {
        this.voxels = this.voxels.filter((v) => v.z < GROUND);
        this.rebuild();
        this.onChange?.();
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
        const shades = this.shadePalette(spread);
        const distinct = [...new Set(shades.map((s) => s.toLowerCase()))];
        const missing = distinct.filter((s) => !this.palette.includes(s));
        // Refuse rather than silently overflow the bounded palette.
        if (missing.length > this.freeSlotCount()) return false;
        for (const s of missing) this.ensurePaletteColor(s);
        // Map each shade to its (now-present) slot so voxels point at indices.
        const shadeIdx = shades.map((s) => this.palette.indexOf(s.toLowerCase()));
        const sel = this.selection;
        const pick = (): number => {
            const z = Math.max(-2.5, Math.min(2.5, gaussian()));
            const idx = Math.round(((z + 2.5) / 5) * (SHADE_STEPS - 1));
            return shadeIdx[Math.max(0, Math.min(SHADE_STEPS - 1, idx))]!;
        };
        for (const v of this.voxels) {
            if (sel.size === 0 || sel.has(keyOf(v.x, v.y, v.z))) v.ci = pick();
        }
        this.rebuild();
        this.onChange?.();
        return true;
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
                    clamp8(base[2] * f),
                ])
            );
        }
        return out;
    }

    /* ── Palette space management ─────────────────────────────── */

    /** New palette slots a Shade needs (distinct shades not yet in the palette). */
    shadeSlotsNeeded(spread: number): number {
        const distinct = new Set(
            this.shadePalette(spread).map((s) => s.toLowerCase())
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
        const used = new Set(this.voxels.map((v) => v.ci));
        return this.palette.reduce<number>(
            (n, c, i) => (c != null && !used.has(i) ? n + 1 : n),
            0
        );
    }

    /** Unassign palette slots no voxel uses (e.g. imported junk); returns count. */
    removeUnusedColors(): number {
        const used = new Set(this.voxels.map((v) => v.ci));
        let removed = 0;
        for (let i = 0; i < this.palette.length; i++) {
            if (this.palette[i] != null && !used.has(i)) {
                this.palette[i] = null;
                removed++;
            }
        }
        if (this.palette[this.activeColorIdx] == null) {
            const first = this.palette.findIndex((c) => c != null);
            this.activeColorIdx = first >= 0 ? first : 0;
        }
        if (removed) this.onChange?.();
        return removed;
    }

    /**
     * Drop voxels that are fully enclosed (all six face-neighbors occupied) and
     * thus never visible — the equivalent of MagicaVoxel's Hull, trimming file
     * size and draw work without changing the silhouette.
     */
    hull(): void {
        if (!this.voxels.length) return;
        const occ = this.occupied();
        const buried = (v: EditVoxel): boolean =>
            occ.has(keyOf(v.x + 1, v.y, v.z)) &&
            occ.has(keyOf(v.x - 1, v.y, v.z)) &&
            occ.has(keyOf(v.x, v.y + 1, v.z)) &&
            occ.has(keyOf(v.x, v.y - 1, v.z)) &&
            occ.has(keyOf(v.x, v.y, v.z + 1)) &&
            occ.has(keyOf(v.x, v.y, v.z - 1));
        this.voxels = this.voxels.filter((v) => !buried(v));
        this.rebuild();
        this.onChange?.();
    }

    /* ── Floor (geometry z-shift) ─────────────────────────────── */

    /**
     * Shift the whole model in z, clamped to stay within [0, 63]. This bakes into
     * the saved geometry, so the chosen burial depth determines where the tile
     * lands when placed (the datum at z = GROUND marks the scene ground line).
     */
    shiftZ(dz: number): void {
        if (!this.voxels.length || dz === 0) return;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (const v of this.voxels) {
            if (v.z < minZ) minZ = v.z;
            if (v.z > maxZ) maxZ = v.z;
        }
        let d = dz;
        if (minZ + d < 0) d = -minZ;
        if (maxZ + d > 63) d = 63 - maxZ;
        if (d === 0) return;
        for (const v of this.voxels) v.z += d;
        if (this.selection.size) {
            const shifted = [...this.selection].map((k) => {
                const [x, y, z] = k.split(",").map(Number) as [
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
        return minZ - GROUND;
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

    private maxZ(): number {
        let mz = 0;
        for (const v of this.voxels) if (v.z > mz) mz = v.z;
        return mz;
    }

    /** Extra world-Y offset applied to a layer in the exploded view. */
    private layerY(z: number): number {
        return z * this.explode * CONFIG.voxel.size;
    }

    /** Voxels currently shown (focus filter applied). */
    private visibleVoxels(): EditVoxel[] {
        if (this.focusLayer == null) return this.voxels;
        return this.voxels.filter((v) => v.z === this.focusLayer);
    }

    clearAll(): void {
        this.voxels = [];
        this.selection.clear();
        this.rebuild();
        this.onChange?.();
    }

    /* ── Editing via raycast ──────────────────────────────────── */

    /** Reset per-stroke dedup state (call on pointer-down). */
    beginStroke(): void {
        this.lastTargetKey = null;
    }

    /**
     * Apply the active tool at a screen pixel. `remove` (modifier held) flips the
     * Select tool to deselect. Returns true if anything changed.
     */
    editAt(clientX: number, clientY: number, remove = false): boolean {
        const ndc = this.toNdc(clientX, clientY);
        this.raycaster.layers.set(1);
        this.raycaster.setFromCamera(ndc, this.view.camera);
        const hit = this.hitMesh
            ? this.raycaster.intersectObject(this.hitMesh, false)[0]
            : undefined;

        if (!hit || hit.instanceId == null) {
            // No voxel under the cursor: only "add" works, dropping onto the floor.
            if (this.tool !== "add") return false;
            const cell = this.floorCell(ndc);
            if (!cell || !this.claimTarget(keyOf(cell.x, cell.y, cell.z))) {
                return false;
            }
            return this.addVoxel(cell.x, cell.y, cell.z);
        }

        const v = this.hitVoxels[hit.instanceId];
        if (!v) return false;
        const here = keyOf(v.x, v.y, v.z);

        switch (this.tool) {
            case "add": {
                const n = hit.face!.normal;
                const tx = v.x + Math.round(n.x);
                const ty = v.y + Math.round(n.z);
                const tz = v.z + Math.round(n.y);
                if (!this.claimTarget(keyOf(tx, ty, tz))) return false;
                return this.addVoxel(tx, ty, tz);
            }
            case "delete":
                if (!this.claimTarget(here)) return false;
                if (this.selection.size > 0) this.applyToSelection("delete");
                else this.removeAt(here);
                return true;
            case "paint":
                if (!this.claimTarget(here)) return false;
                if (this.selection.size > 0) this.applyToSelection("paint");
                else this.paintAt(here);
                return true;
            case "select":
                if (!this.claimTarget(here)) return false;
                if (remove) this.selection.delete(here);
                else this.selection.add(here);
                this.rebuildSelection();
                this.onChange?.();
                return true;
            case "eyedropper":
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

    private applyToSelection(op: "delete" | "paint"): void {
        if (op === "delete") {
            this.voxels = this.voxels.filter(
                (v) => !this.selection.has(keyOf(v.x, v.y, v.z))
            );
        } else {
            for (const v of this.voxels) {
                if (this.selection.has(keyOf(v.x, v.y, v.z)))
                    v.ci = this.activeColorIdx;
            }
        }
        this.selection.clear();
        this.rebuild();
        this.onChange?.();
    }

    private removeAt(key: string): void {
        this.voxels = this.voxels.filter((v) => keyOf(v.x, v.y, v.z) !== key);
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
        const x = Math.floor(p.x + HALF);
        const y = Math.floor(p.z + HALF);
        if (x < 0 || y < 0 || x >= N || y >= N) return null;
        return { x, y, z: 0 };
    }

    private addVoxel(x: number, y: number, z: number): boolean {
        if (x < 0 || y < 0 || x >= N || y >= N || z < 0 || z >= 64)
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
            batch.add(this.materialize(visible), { origin: [-HALF, 0, -HALF] });
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
                    origin: [-HALF, this.layerY(z), -HALF],
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
            const ox = v.x + 0.5 - HALF;
            const oy = v.z + 0.5 + this.layerY(v.z);
            const oz = v.y + 0.5 - HALF;
            const o = i * stride;
            for (let j = 0; j < stride; j += 3) {
                arr[o + j] = tpl[j]! + ox;
                arr[o + j + 1] = tpl[j + 1]! + oy;
                arr[o + j + 2] = tpl[j + 2]! + oz;
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
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
                v.x + 0.5 - HALF,
                v.z + 0.5 + this.layerY(v.z),
                v.y + 0.5 - HALF
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
        // Only highlight selected voxels that are currently shown (focus filter).
        const visKeys = [...this.selection].filter((k) => {
            if (this.focusLayer == null) return true;
            return Number(k.split(",")[2]) === this.focusLayer;
        });
        if (visKeys.length === 0) return;

        const mesh = new THREE.InstancedMesh(
            this.selGeo,
            this.selMat,
            visKeys.length
        );
        const m = new THREE.Matrix4();
        let i = 0;
        for (const k of visKeys) {
            const [x, y, z] = k.split(",").map(Number) as [
                number,
                number,
                number
            ];
            m.setPosition(
                x + 0.5 - HALF,
                z + 0.5 + this.layerY(z),
                y + 0.5 - HALF
            );
            mesh.setMatrixAt(i++, m);
        }
        mesh.instanceMatrix.needsUpdate = true;
        this.selectionMesh = mesh;
        this.root.add(mesh);
    }

    private buildFloor(): void {
        this.grid = new THREE.GridHelper(N, N, 0x9c8f6e, 0xc4b99a);
        (this.grid.material as THREE.Material).transparent = true;
        (this.grid.material as THREE.Material).opacity = 0.6;
        this.grid.visible = this.gridOn;
        this.root.add(this.grid);

        // Datum: the fixed plane that meets scene ground (z = GROUND). Voxels
        // below it are buried when placed; the Floor tool shifts the model
        // relative to this line.
        // The fill extends far outward but is hollowed over the 12×12 column
        // footprint so it doesn't clip through tiles inside the column.
        const outerHalf = 500;
        const shape = new THREE.Shape();
        shape.moveTo(-outerHalf, -outerHalf);
        shape.lineTo(outerHalf, -outerHalf);
        shape.lineTo(outerHalf, outerHalf);
        shape.lineTo(-outerHalf, outerHalf);
        shape.closePath();
        const hole = new THREE.Path();
        hole.moveTo(-HALF, -HALF);
        hole.lineTo(-HALF, HALF);
        hole.lineTo(HALF, HALF);
        hole.lineTo(HALF, -HALF);
        hole.closePath();
        shape.holes.push(hole);
        const fillGeo = new THREE.ShapeGeometry(shape);
        fillGeo.rotateX(-Math.PI / 2);

        const borderCorners = [
            new THREE.Vector3(-HALF, 0, -HALF),
            new THREE.Vector3(HALF, 0, -HALF),
            new THREE.Vector3(HALF, 0, HALF),
            new THREE.Vector3(-HALF, 0, HALF),
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
                    depthWrite: false,
                })
            ),
            new THREE.LineLoop(
                borderGeo,
                new THREE.LineBasicMaterial({
                    color: 0x1b5ba8,
                    opacity: 0.5,
                    transparent: true,
                })
            )
        );
        datum.position.y = GROUND * CONFIG.voxel.size;
        this.root.add(datum);
    }

    private occupied(): Set<string> {
        return new Set(this.voxels.map((v) => keyOf(v.x, v.y, v.z)));
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
            child.traverse((o) => {
                const mesh = o as Partial<THREE.Mesh>;
                mesh.geometry?.dispose();
                const mat = mesh.material;
                if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
                else mat?.dispose();
            });
        }
    }
}

function keyOf(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
}

function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.replace("#", ""), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
    const h = (v: number) => v.toString(16).padStart(2, "0");
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
    const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
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
    const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [
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
