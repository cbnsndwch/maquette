import * as THREE from 'three';

import { VoxelBatch, type Voxel } from '@cbnsndwch/world-core';

import { CONFIG } from '../config.js';
import type { SceneView } from './scene-view.js';

const N = CONFIG.voxel.perTile; // 12 — footprint edge in voxels
const HALF = N / 2;
const GROUND = CONFIG.groundLayers; // voxel layer that meets the scene ground

export type EditTool = 'add' | 'delete' | 'paint' | 'eyedropper';

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

/**
 * Authors a single 12×12×H tile by per-voxel editing — the granularity the scene
 * builder lacks. Reuses {@link VoxelBatch} for display and an invisible
 * InstancedMesh hitbox (on layer 1) for face-normal raycasting, mirroring the
 * inspect-page editor. The model is centered at the world origin, rising from
 * y = 0; a datum plane marks the layer (z = groundLayers) that will sit at scene
 * ground level, so authors can see which layers get buried.
 */
export class TileEditor {
    voxels: Voxel[] = [];
    palette: string[] = [...DEFAULT_PALETTE];
    activeColorIdx = 0;
    tool: EditTool = 'add';

    private readonly root = new THREE.Group();
    private readonly display = new THREE.Group();
    private hitMesh: THREE.InstancedMesh | null = null;
    private readonly hitGeo = new THREE.BoxGeometry(1, 1, 1);
    private readonly hitMat = new THREE.MeshBasicMaterial();
    private readonly raycaster = new THREE.Raycaster();
    private readonly floorPlane = new THREE.Plane(
        new THREE.Vector3(0, 1, 0),
        0
    );

    /** Called after any edit so the UI (palette, info) can refresh. */
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
        this.palette = [...DEFAULT_PALETTE];
        this.activeColorIdx = 0;
        this.tool = 'add';
        this.rebuild();
        this.onChange?.();
    }

    setTool(t: EditTool): void {
        this.tool = t;
        this.onChange?.();
    }

    setColor(hex: string): void {
        const c = hex.toLowerCase();
        const i = this.palette.indexOf(c);
        this.activeColorIdx = i >= 0 ? i : this.palette.push(c) - 1;
        this.onChange?.();
    }

    selectColorIdx(i: number): void {
        if (i >= 0 && i < this.palette.length) {
            this.activeColorIdx = i;
            this.onChange?.();
        }
    }

    /** Fill the buried base layers (z 0..groundLayers-1) with the active color. */
    fillBase(): void {
        const occ = this.occupied();
        for (let z = 0; z < GROUND; z++) {
            for (let y = 0; y < N; y++) {
                for (let x = 0; x < N; x++) {
                    if (!occ.has(key(x, y, z))) {
                        this.voxels.push({ x, y, z, c: this.activeColor });
                    }
                }
            }
        }
        this.rebuild();
        this.onChange?.();
    }

    /* ── Editing via raycast ──────────────────────────────────── */

    /** Apply the active tool at a screen pixel. Returns true if anything changed. */
    editAt(clientX: number, clientY: number): boolean {
        const ndc = this.toNdc(clientX, clientY);
        this.raycaster.setFromCamera(ndc, this.view.camera);

        const hit = this.hitMesh
            ? this.raycaster.intersectObject(this.hitMesh, false)[0]
            : undefined;

        if (!hit || hit.instanceId == null) {
            // No voxel under the cursor: only "add" works, dropping onto the floor.
            return this.tool === 'add' ? this.addOnFloor(ndc) : false;
        }

        const idx = hit.instanceId;
        const v = this.voxels[idx];
        if (!v) return false;

        switch (this.tool) {
            case 'add': {
                const n = hit.face!.normal;
                return this.addVoxel(
                    v.x + Math.round(n.x),
                    v.y + Math.round(n.z),
                    v.z + Math.round(n.y)
                );
            }
            case 'delete':
                this.voxels.splice(idx, 1);
                this.rebuild();
                this.onChange?.();
                return true;
            case 'paint':
                if (v.c === this.activeColor) return false;
                v.c = this.activeColor;
                this.rebuild();
                this.onChange?.();
                return true;
            case 'eyedropper':
                this.setColor(v.c);
                return true;
        }
    }

    private addOnFloor(ndc: THREE.Vector2): boolean {
        this.raycaster.layers.set(0); // hit the ground, not the hitbox layer
        this.raycaster.setFromCamera(ndc, this.view.camera);
        const p = new THREE.Vector3();
        const ok = this.raycaster.ray.intersectPlane(this.floorPlane, p);
        this.raycaster.layers.set(1);
        if (!ok) return false;
        return this.addVoxel(Math.floor(p.x + HALF), Math.floor(p.z + HALF), 0);
    }

    private addVoxel(x: number, y: number, z: number): boolean {
        if (x < 0 || y < 0 || x >= N || y >= N || z < 0 || z >= 64)
            return false;
        if (this.occupied().has(key(x, y, z))) return false;
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
        this.view.scene.updateMatrixWorld(true);
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

    private buildFloor(): void {
        const grid = new THREE.GridHelper(N, N, 0x9c8f6e, 0xc4b99a);
        (grid.material as THREE.Material).transparent = true;
        (grid.material as THREE.Material).opacity = 0.6;
        this.root.add(grid);

        // Datum: the plane that meets scene ground — voxels below it get buried.
        const datum = new THREE.Mesh(
            new THREE.PlaneGeometry(N, N).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({
                color: 0x1b5ba8,
                transparent: true,
                opacity: 0.12,
                depthWrite: false
            })
        );
        datum.position.y = GROUND * CONFIG.voxel.size;
        this.root.add(datum);
        const datumEdge = new THREE.LineSegments(
            new THREE.EdgesGeometry(
                new THREE.PlaneGeometry(N, N).rotateX(-Math.PI / 2)
            ),
            new THREE.LineBasicMaterial({
                color: 0x1b5ba8,
                opacity: 0.5,
                transparent: true
            })
        );
        datumEdge.position.y = GROUND * CONFIG.voxel.size;
        this.root.add(datumEdge);
    }

    private occupied(): Set<string> {
        return new Set(this.voxels.map(v => key(v.x, v.y, v.z)));
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

function key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
}
