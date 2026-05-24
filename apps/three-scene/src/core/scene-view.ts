import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { VoxelBatch } from '@cbnsndwch/world-core';

import { CONFIG } from '../config.js';
import type { Rotation, TileMap } from '../grid/tile-map.js';
import type { Tool } from './game.js';
import type { VoxelAssets } from './voxel-assets.js';

const P = CONFIG.voxel.perTile * CONFIG.voxel.size; // world span of one cell edge
const G = CONFIG.groundLayers * CONFIG.voxel.size; // buried depth below y = 0
const { width: W, height: H } = CONFIG.grid;

type HoverStyle = 'valid' | 'invalid' | 'erase';
const HOVER_COLOR: Record<HoverStyle, number> = {
    valid: 0x1b5ba8,
    invalid: 0xd85b5b,
    erase: 0xd85b8e
};

interface Pop {
    start: number;
    group: THREE.Group;
}

/**
 * Owns the Three.js scene, camera, controls and render loop, and turns the
 * {@link TileMap}'s terrain grid into real voxel meshes. This is the 3D analogue
 * of the reference renderer's stacked-raster canvas: instead of painting iso
 * sprites we bake each placed cell's `.vox` voxels into instanced cubes.
 */
export class SceneView {
    readonly renderer: THREE.WebGLRenderer;
    readonly scene: THREE.Scene;
    readonly camera: THREE.PerspectiveCamera;
    readonly controls: OrbitControls;

    private readonly terrainGroup = new THREE.Group();
    private readonly overlayGroup = new THREE.Group();
    private readonly highlight: THREE.Group;
    private readonly highlightFill: THREE.Mesh;
    private readonly highlightLine: THREE.LineSegments;
    private ghost: THREE.Group | null = null;
    private grid: THREE.GridHelper;

    private readonly raycaster = new THREE.Raycaster();
    private readonly groundPlane = new THREE.Plane(
        new THREE.Vector3(0, 1, 0),
        0
    );

    private builtVersion = -1;
    private readonly animating = new Map<string, Pop>();

    constructor(
        container: HTMLElement,
        private readonly tileMap: TileMap,
        private readonly assets: VoxelAssets
    ) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#f4ecd9');

        this.camera = new THREE.PerspectiveCamera(
            CONFIG.camera.fov,
            window.innerWidth / window.innerHeight,
            CONFIG.camera.near,
            CONFIG.camera.far
        );
        const span = W * P; // full island edge in world units
        this.camera.position.set(span * 0.85, span * 0.7, span * 0.85);

        this.controls = new OrbitControls(
            this.camera,
            this.renderer.domElement
        );
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.target.set(0, 0, 0);
        this.controls.minDistance = span * 0.25;
        this.controls.maxDistance = span * 2.5;
        this.controls.maxPolarAngle = Math.PI * 0.495; // stay above the island
        this.controls.autoRotate = true; // gentle showcase orbit by default
        this.controls.autoRotateSpeed = 0.6;
        this.setCameraButtons('place');
        this.controls.update();

        // Floating-island substrate, drawn as a transparent volume with thin
        // edges so a placed cell's full height — including its buried 4 layers —
        // stays visible. Slightly oversized so the rim sits just outside the cells.
        const slab = this.makeSubstrate(W * P + 3, G, H * P + 3);
        slab.position.set(0, -G / 2 - 0.05, 0);
        this.scene.add(slab);

        this.grid = new THREE.GridHelper(W * P, W, 0x9c8f6e, 0xbcae8a);
        this.grid.position.y = 0.04;
        (this.grid.material as THREE.Material).transparent = true;
        (this.grid.material as THREE.Material).opacity = 0.5;
        this.grid.visible = false;
        this.scene.add(this.grid);

        this.scene.add(this.terrainGroup);
        this.scene.add(this.overlayGroup);

        // Reusable hover highlight (a flat fill quad + a bright border loop).
        this.highlightFill = new THREE.Mesh(
            new THREE.PlaneGeometry(P, P).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({
                color: HOVER_COLOR.valid,
                transparent: true,
                opacity: 0.16,
                depthWrite: false
            })
        );
        this.highlightLine = new THREE.LineSegments(
            new THREE.EdgesGeometry(
                new THREE.PlaneGeometry(P, P).rotateX(-Math.PI / 2)
            ),
            new THREE.LineBasicMaterial({ color: HOVER_COLOR.valid })
        );
        this.highlight = new THREE.Group();
        this.highlight.add(this.highlightFill, this.highlightLine);
        this.highlight.position.y = 0.06;
        this.highlight.visible = false;
        this.scene.add(this.highlight);

        window.addEventListener('resize', () => this.onResize());
        this.renderer.setAnimationLoop(t => this.frame(t));
    }

    /* ── World ↔ cell mapping ─────────────────────────────────── */

    /** World-space origin (voxel-local 0,0,0 corner) of a cell. */
    private cellOrigin(gx: number, gy: number): [number, number, number] {
        return [(gx - W / 2) * P, -G, (gy - H / 2) * P];
    }

    /** World-space center of a cell on the ground plane. */
    private cellCenter(gx: number, gy: number): THREE.Vector3 {
        const [ox, , oz] = this.cellOrigin(gx, gy);
        return new THREE.Vector3(ox + P / 2, 0, oz + P / 2);
    }

    /** Cell under a screen pixel, via a ground-plane raycast. */
    cellFromClient(
        clientX: number,
        clientY: number
    ): { gx: number; gy: number } | null {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        const hit = new THREE.Vector3();
        if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit))
            return null;
        const gx = Math.floor(hit.x / P + W / 2);
        const gy = Math.floor(hit.z / P + H / 2);
        if (!this.tileMap.inBounds(gx, gy)) return null;
        return { gx, gy };
    }

    /* ── Terrain meshes ───────────────────────────────────────── */

    /** Rebuild the static terrain meshes if the tile map changed. */
    syncTerrain(): void {
        if (this.tileMap.terrainVersion === this.builtVersion) return;
        this.rebuildNow();
    }

    private rebuildNow(): void {
        this.disposeGroup(this.terrainGroup);
        const batch = new VoxelBatch(CONFIG.voxel.size);
        this.tileMap.forEach((gx, gy, cell) => {
            if (this.animating.has(`${gx},${gy}`)) return; // popping cells draw in overlay
            const voxels = this.assets.get(cell.id);
            if (voxels.length) {
                batch.add(voxels, {
                    origin: this.cellOrigin(gx, gy),
                    rotation: cell.rot,
                    span: CONFIG.voxel.perTile
                });
            }
        });
        if (batch.count > 0) this.terrainGroup.add(batch.build());
        this.builtVersion = this.tileMap.terrainVersion;
    }

    /**
     * Fold a freshly-placed cell in with an elastic pop. The cell is excluded
     * from the static mesh while it animates (so it doesn't double-draw), then
     * baked in when the animation settles.
     */
    onPlaced(gx: number, gy: number): void {
        const cell = this.tileMap.getTerrain(gx, gy);
        if (!cell) {
            this.syncTerrain();
            return;
        }
        const key = `${gx},${gy}`;
        const existing = this.animating.get(key);
        if (existing) {
            this.overlayGroup.remove(existing.group);
            this.disposeObject(existing.group);
        }

        // Build the cell relative to its center so we can scale about that pivot.
        const center = this.cellCenter(gx, gy);
        const [ox, oy, oz] = this.cellOrigin(gx, gy);
        const batch = new VoxelBatch(CONFIG.voxel.size);
        batch.add(this.assets.get(cell.id), {
            origin: [ox - center.x, oy, oz - center.z],
            rotation: cell.rot,
            span: CONFIG.voxel.perTile
        });
        const group = batch.build();
        group.position.set(center.x, 0, center.z);
        group.scale.setScalar(0.001);
        this.overlayGroup.add(group);

        this.animating.set(key, { start: performance.now(), group });
        this.rebuildNow();
    }

    /* ── Hover highlight + ghost preview ──────────────────────── */

    setHover(
        cell: { gx: number; gy: number } | null,
        opts: { style: HoverStyle; assetId: string | null; rotation: Rotation }
    ): void {
        if (!cell) {
            this.highlight.visible = false;
            this.clearGhost();
            return;
        }
        const center = this.cellCenter(cell.gx, cell.gy);
        this.highlight.position.set(center.x, 0.06, center.z);
        this.highlight.visible = true;
        const color = HOVER_COLOR[opts.style];
        (this.highlightFill.material as THREE.MeshBasicMaterial).color.setHex(
            color
        );
        (this.highlightLine.material as THREE.LineBasicMaterial).color.setHex(
            color
        );

        this.updateGhost(
            cell,
            opts.style === 'valid' ? opts.assetId : null,
            opts.rotation
        );
    }

    private updateGhost(
        cell: { gx: number; gy: number },
        assetId: string | null,
        rotation: Rotation
    ): void {
        this.clearGhost();
        if (!assetId) return;
        const voxels = this.assets.get(assetId);
        if (!voxels.length) return;
        const batch = new VoxelBatch(CONFIG.voxel.size);
        batch.add(voxels, {
            origin: this.cellOrigin(cell.gx, cell.gy),
            rotation,
            span: CONFIG.voxel.perTile
        });
        const group = batch.build();
        group.traverse(o => {
            const mesh = o as THREE.Mesh;
            const mat = mesh.material as THREE.Material | undefined;
            if (mat) {
                mat.transparent = true;
                mat.opacity = 0.4;
                mat.depthWrite = false;
            }
        });
        this.ghost = group;
        this.scene.add(group);
    }

    private clearGhost(): void {
        if (!this.ghost) return;
        this.scene.remove(this.ghost);
        this.disposeObject(this.ghost);
        this.ghost = null;
    }

    /* ── Misc ─────────────────────────────────────────────────── */

    setGridVisible(visible: boolean): void {
        this.grid.visible = visible;
    }

    setAutoRotate(on: boolean): void {
        this.controls.autoRotate = on;
    }

    get autoRotate(): boolean {
        return this.controls.autoRotate;
    }

    /**
     * Map the left mouse button for the active tool. Pan grabs the camera with
     * the left button; place/erase leave the left button free for our own
     * placement brush (camera orbit stays on right-drag, pan on middle-drag).
     */
    setCameraButtons(tool: Tool): void {
        this.controls.mouseButtons =
            tool === 'pan'
                ? {
                      LEFT: THREE.MOUSE.PAN,
                      MIDDLE: THREE.MOUSE.DOLLY,
                      RIGHT: THREE.MOUSE.ROTATE
                  }
                : {
                      LEFT: null,
                      MIDDLE: THREE.MOUSE.PAN,
                      RIGHT: THREE.MOUSE.ROTATE
                  };
    }

    private frame(now: number): void {
        for (const [key, pop] of this.animating) {
            const t = (now - pop.start) / 380;
            if (t >= 1) {
                this.overlayGroup.remove(pop.group);
                this.disposeObject(pop.group);
                this.animating.delete(key);
                this.rebuildNow(); // bake the settled cell into the static mesh
                continue;
            }
            pop.group.scale.setScalar(easeOutBack(t));
        }
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    private onResize(): void {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    /* ── Geometry helpers ─────────────────────────────────────── */

    private makeSubstrate(w: number, h: number, d: number): THREE.Group {
        const box = new THREE.BoxGeometry(w, h, d);
        // Faint translucent body: the island still reads as a solid volume, but
        // placed cells show straight through it. depthWrite off so it never
        // occludes the opaque cubes behind it.
        const fill = new THREE.Mesh(
            box,
            new THREE.MeshBasicMaterial({
                color: new THREE.Color('#d9c79e'),
                transparent: true,
                opacity: 0.1,
                depthWrite: false
            })
        );
        // Thin edges tracing the slab footprint + buried depth.
        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(box),
            new THREE.LineBasicMaterial({
                color: new THREE.Color('#a8946a'),
                transparent: true,
                opacity: 0.85
            })
        );
        const group = new THREE.Group();
        group.add(fill, edges);
        return group;
    }

    private disposeGroup(group: THREE.Group): void {
        for (const child of [...group.children]) {
            group.remove(child);
            this.disposeObject(child);
        }
    }

    private disposeObject(obj: THREE.Object3D): void {
        obj.traverse(o => {
            const mesh = o as Partial<THREE.Mesh>;
            mesh.geometry?.dispose();
            const mat = mesh.material;
            if (Array.isArray(mat)) mat.forEach(m => m.dispose());
            else mat?.dispose();
        });
    }
}

/** Elastic-ish overshoot used for the placement pop. */
function easeOutBack(t: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const x = t - 1;
    return 1 + c3 * x * x * x + c1 * x * x;
}
