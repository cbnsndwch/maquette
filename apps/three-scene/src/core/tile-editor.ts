import * as THREE from 'three';

import { VoxelBatch, type Voxel } from '@cbnsndwch/world-core';

import { CONFIG } from '../config.js';
import type { SceneView } from './scene-view.js';

const N = CONFIG.voxel.perTile; // 12 — footprint edge in voxels
const HALF = N / 2;
const DEFAULT_GROUND = CONFIG.groundLayers; // default # of buried layers
const MAX_GROUND = 32; // clamp for the movable floor
/** Fixed palette size — an 8×32 grid, matching the importable palette image. */
const PALETTE_SIZE = 256;

export type EditTool = 'add' | 'delete' | 'paint' | 'eyedropper' | 'select';

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
    voxels: Voxel[] = [];
    /** Fixed 256-slot palette; null = unassigned (shown as an empty swatch). */
    palette: (string | null)[] = makeDefaultPalette();
    activeColorIdx = 0;
    tool: EditTool = 'add';
    /** Selected voxel position keys ("x,y,z"). */
    readonly selection = new Set<string>();
    /** Id of the tile being edited (set by {@link loadTile}); null for a new tile. */
    editingId: string | null = null;
    /** Voxel layer that meets scene ground — movable so the floor can be re-placed. */
    groundLevel: number = DEFAULT_GROUND;
    gridOn = true;
    edgesOn = false;

    private readonly root = new THREE.Group();
    private readonly display = new THREE.Group();
    private hitMesh: THREE.InstancedMesh | null = null;
    private selectionMesh: THREE.InstancedMesh | null = null;
    private edges: THREE.LineSegments | null = null;
    private grid!: THREE.GridHelper;
    private datum!: THREE.Object3D;
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

    constructor(private readonly view: SceneView) {
        this.raycaster.layers.set(1);
        this.root.visible = false;
        this.root.add(this.display);
        this.buildFloor();
        this.view.scene.add(this.root);
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
        this.selection.clear();
        this.rebuild();
        this.onChange?.();
    }

    /**
     * Load an existing tile's voxels for editing. The palette is seeded from the
     * tile's own colors (first-seen order) so its limited palette is preserved;
     * {@link editingId} is set so a save overwrites the same tile.
     */
    loadTile(voxels: readonly Voxel[], id: string): void {
        this.voxels = voxels.map(v => ({ x: v.x, y: v.y, z: v.z, c: v.c }));
        const colors: string[] = [];
        const seen = new Set<string>();
        for (const v of this.voxels) {
            const c = v.c.toLowerCase();
            if (!seen.has(c)) {
                seen.add(c);
                colors.push(c);
            }
        }
        this.palette = colors.length ? toSlots(colors) : makeDefaultPalette();
        this.activeColorIdx = 0;
        this.tool = 'add';
        this.editingId = id;
        this.selection.clear();
        this.rebuild();
        this.onChange?.();
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

    /** Assign a color to a specific palette slot (from the swatch popover). */
    setSlotColor(i: number, hex: string): void {
        if (i < 0 || i >= PALETTE_SIZE) return;
        this.palette[i] = hex.toLowerCase();
        this.activeColorIdx = i;
        this.onChange?.();
    }

    /** Unassign a palette slot. */
    clearSlot(i: number): void {
        if (i < 0 || i >= PALETTE_SIZE || this.palette[i] == null) return;
        this.palette[i] = null;
        if (this.activeColorIdx === i) {
            const next = this.palette.findIndex(c => c != null);
            this.activeColorIdx = next >= 0 ? next : 0;
        }
        this.onChange?.();
    }

    /** Replace the whole palette (e.g. imported from an image). */
    setPalette(colors: readonly (string | null)[]): void {
        this.palette = toSlots(colors);
        const first = this.palette.findIndex(c => c != null);
        this.activeColorIdx = first >= 0 ? first : 0;
        this.onChange?.();
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
            v => !this.selection.has(keyOf(v.x, v.y, v.z))
        );
        this.selection.clear();
        this.rebuild();
        this.onChange?.();
    }

    /** Recolor every selected voxel; the selection stays so it can be reused. */
    recolorSelection(hex: string): void {
        if (this.selection.size === 0) return;
        const c = hex.toLowerCase();
        this.setColor(c); // ensure it's in the palette + active
        for (const v of this.voxels) {
            if (this.selection.has(keyOf(v.x, v.y, v.z))) v.c = c;
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
        const moves: { v: Voxel; nx: number; ny: number; nz: number }[] = [];
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

    /** Fill the buried base layers (z 0..groundLevel-1) with the active color. */
    fillBase(): void {
        const occ = this.occupied();
        for (let z = 0; z < this.groundLevel; z++) {
            for (let y = 0; y < N; y++) {
                for (let x = 0; x < N; x++) {
                    if (!occ.has(keyOf(x, y, z))) {
                        this.voxels.push({ x, y, z, c: this.activeColor });
                    }
                }
            }
        }
        this.rebuild();
        this.onChange?.();
    }

    /** Remove the buried base layers (z < groundLevel). */
    clearBase(): void {
        this.voxels = this.voxels.filter(v => v.z >= this.groundLevel);
        this.rebuild();
        this.onChange?.();
    }

    /** Remove everything above ground (z >= groundLevel). */
    clearTop(): void {
        this.voxels = this.voxels.filter(v => v.z < this.groundLevel);
        this.rebuild();
        this.onChange?.();
    }

    /* ── Floor / view toggles ─────────────────────────────────── */

    /** Move the ground datum up/down (clamped); the buried-layer line follows. */
    setGroundLevel(z: number): void {
        const next = Math.max(0, Math.min(MAX_GROUND, Math.round(z)));
        if (next === this.groundLevel) return;
        this.groundLevel = next;
        this.datum.position.y = next * CONFIG.voxel.size;
        this.onChange?.();
    }

    raiseGround(): void {
        this.setGroundLevel(this.groundLevel + 1);
    }

    lowerGround(): void {
        this.setGroundLevel(this.groundLevel - 1);
    }

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
            if (this.tool !== 'add') return false;
            const cell = this.floorCell(ndc);
            if (!cell || !this.claimTarget(keyOf(cell.x, cell.y, cell.z))) {
                return false;
            }
            return this.addVoxel(cell.x, cell.y, cell.z);
        }

        const v = this.voxels[hit.instanceId];
        if (!v) return false;
        const here = keyOf(v.x, v.y, v.z);

        switch (this.tool) {
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
            case 'select':
                if (!this.claimTarget(here)) return false;
                if (remove) this.selection.delete(here);
                else this.selection.add(here);
                this.rebuildSelection();
                this.onChange?.();
                return true;
            case 'eyedropper':
                this.setColor(v.c);
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
                    v.c = this.activeColor;
            }
        }
        this.selection.clear();
        this.rebuild();
        this.onChange?.();
    }

    private removeAt(key: string): void {
        this.voxels = this.voxels.filter(v => keyOf(v.x, v.y, v.z) !== key);
        this.rebuild();
        this.onChange?.();
    }

    private paintAt(key: string): void {
        for (const v of this.voxels) {
            if (keyOf(v.x, v.y, v.z) === key) v.c = this.activeColor;
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
        this.voxels.push({ x, y, z, c: this.activeColor });
        this.rebuild();
        this.onChange?.();
        return true;
    }

    /* ── Rendering ────────────────────────────────────────────── */

    private rebuild(): void {
        this.disposeDisplay();
        if (this.voxels.length) {
            const batch = new VoxelBatch(CONFIG.voxel.size);
            batch.add(this.voxels, { origin: [-HALF, 0, -HALF] });
            this.display.add(batch.build());
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
        if (!this.edgesOn || !this.voxels.length) return;
        const tpl = this.edgeTemplate;
        const stride = tpl.length; // 72 = 24 verts × 3
        const arr = new Float32Array(this.voxels.length * stride);
        for (let i = 0; i < this.voxels.length; i++) {
            const v = this.voxels[i]!;
            const ox = v.x + 0.5 - HALF;
            const oy = v.z + 0.5;
            const oz = v.y + 0.5 - HALF;
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
        if (!this.voxels.length) return;
        const mesh = new THREE.InstancedMesh(
            this.hitGeo,
            this.hitMat,
            this.voxels.length
        );
        mesh.layers.set(1); // raycast-only; camera renders layer 0
        const m = new THREE.Matrix4();
        for (let i = 0; i < this.voxels.length; i++) {
            const v = this.voxels[i]!;
            m.setPosition(v.x + 0.5 - HALF, v.z + 0.5, v.y + 0.5 - HALF);
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
        if (this.selection.size === 0) return;

        const mesh = new THREE.InstancedMesh(
            this.selGeo,
            this.selMat,
            this.selection.size
        );
        const m = new THREE.Matrix4();
        let i = 0;
        for (const k of this.selection) {
            const [x, y, z] = k.split(',').map(Number) as [
                number,
                number,
                number
            ];
            m.setPosition(x + 0.5 - HALF, z + 0.5, y + 0.5 - HALF);
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

        // Datum: the (movable) plane that meets scene ground — voxels below it get
        // buried. Plane + edge loop are grouped so they move together.
        const planeGeo = new THREE.PlaneGeometry(N, N).rotateX(-Math.PI / 2);
        const datum = new THREE.Group();
        datum.add(
            new THREE.Mesh(
                planeGeo,
                new THREE.MeshBasicMaterial({
                    color: 0x1b5ba8,
                    transparent: true,
                    opacity: 0.12,
                    depthWrite: false
                })
            ),
            new THREE.LineSegments(
                new THREE.EdgesGeometry(planeGeo),
                new THREE.LineBasicMaterial({
                    color: 0x1b5ba8,
                    opacity: 0.5,
                    transparent: true
                })
            )
        );
        datum.position.y = this.groundLevel * CONFIG.voxel.size;
        this.datum = datum;
        this.root.add(datum);
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
