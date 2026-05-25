import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { VoxelBatch } from '@cbnsndwch/world-core';
import {
    ASSET_INDEX,
    type BuildingPlacement,
    footprintOf,
    rotatedFootprint,
    type Rotation,
    type TileMap
} from '@cbnsndwch/scene-author';

import { CONFIG } from '../config.js';
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
    private substrate!: THREE.Group;

    private readonly raycaster = new THREE.Raycaster();
    private readonly groundPlane = new THREE.Plane(
        new THREE.Vector3(0, 1, 0),
        0
    );

    private builtVersion = -1;
    private gridOn = false;
    private readonly animating = new Map<string, Pop>();
    /** Bound resize handler, kept as a field so {@link dispose} can remove it. */
    private readonly onResizeBound = (): void => this.onResize();

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
        this.controls.minDistance = P * 0.5; // close enough to edit a single tile
        this.controls.maxDistance = span * 2.5;
        this.controls.maxPolarAngle = Math.PI * 0.495; // stay above the island
        this.controls.autoRotate = true; // gentle showcase orbit by default
        this.controls.autoRotateSpeed = 0.6;
        this.setCameraButtons('place');
        this.controls.update();

        // Floating-island substrate, drawn as a transparent volume with thin
        // edges so a placed cell's full height — including its buried 4 layers —
        // stays visible. Slightly oversized so the rim sits just outside the cells.
        this.substrate = this.makeSubstrate(W * P + 3, G, H * P + 3);
        this.substrate.position.set(0, -G / 2 - 0.05, 0);
        this.scene.add(this.substrate);

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

        window.addEventListener('resize', this.onResizeBound);
        this.renderer.setAnimationLoop(t => this.frame(t));
    }

    /**
     * Tear down the render loop, listeners and the WebGL context. Only needed if
     * the engine singleton is ever recreated (e.g. an HMR path that rebuilds the
     * bootstrap); the persistent canvas otherwise never disposes the renderer.
     */
    dispose(): void {
        this.renderer.setAnimationLoop(null);
        window.removeEventListener('resize', this.onResizeBound);
        this.controls.dispose();
        this.renderer.dispose();
        this.renderer.forceContextLoss();
    }

    /* ── World ↔ cell mapping ─────────────────────────────────── */

    /**
     * World-space origin (voxel-local 0,0,0 corner) of a cell sitting at voxel
     * altitude `baseZ` in its column (0 = ground level, buried `groundLayers`).
     */
    private cellOrigin(
        gx: number,
        gy: number,
        baseZ = 0
    ): [number, number, number] {
        return [
            (gx - W / 2) * P,
            -G + baseZ * CONFIG.voxel.size,
            (gy - H / 2) * P
        ];
    }

    /** World-space center of a cell footprint (y ignored by callers). */
    private cellCenter(gx: number, gy: number): THREE.Vector3 {
        const [ox, , oz] = this.cellOrigin(gx, gy);
        return new THREE.Vector3(ox + P / 2, 0, oz + P / 2);
    }

    /** Voxel height of a cell asset. */
    private cellHeight(id: string): number {
        return this.assets.dims(id)[2];
    }

    /** Nature and props tiles render at the column base (z=0) so they clip into terrain. */
    private isGroundAnchored(id: string): boolean {
        const cat = ASSET_INDEX[id]?.category ?? 'terrain';
        return cat === 'nature' || cat === 'props';
    }

    /** Cumulative voxel height of a column = base altitude for the next cell. */
    private columnBaseZ(gx: number, gy: number): number {
        let base = 0;
        for (const c of this.tileMap.getStack(gx, gy)) {
            base += this.cellHeight(c.id);
        }
        return base;
    }

    /**
     * Terrain surface altitude at a column — non-ground-anchored heights only
     * (props/nature clip in at z=0 and don't raise the surface). This is the
     * altitude a building footprint rests on; mirrors `PlacementSystem.columnBase`.
     */
    private columnTerrainBaseZ(gx: number, gy: number): number {
        let base = 0;
        for (const c of this.tileMap.getStack(gx, gy)) {
            if (!this.isGroundAnchored(c.id)) base += this.cellHeight(c.id);
        }
        return base;
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

    /**
     * Force the next {@link syncTerrain} to rebuild even if the tile map is
     * unchanged — used after a tile's voxels are edited so placed instances pick
     * up the new geometry.
     */
    invalidateTerrain(): void {
        this.builtVersion = -1;
    }

    private rebuildNow(): void {
        this.disposeGroup(this.terrainGroup);
        const batch = new VoxelBatch(CONFIG.voxel.size);
        this.tileMap.forEachColumn((gx, gy, stack) => {
            let base = 0;
            for (let level = 0; level < stack.length; level++) {
                const cell = stack[level]!;
                const voxels = this.assets.get(cell.id);
                const anchored = this.isGroundAnchored(cell.id);
                // A popping cell is drawn by the overlay, not the static mesh.
                if (
                    voxels.length &&
                    !this.animating.has(`${gx},${gy}:${level}`)
                ) {
                    batch.add(voxels, {
                        origin: this.cellOrigin(gx, gy, anchored ? 0 : base),
                        rotation: cell.rot,
                        span: CONFIG.voxel.perTile
                    });
                }
                if (!anchored) base += this.cellHeight(cell.id);
            }
        });
        // Buildings render once at their anchor, spanning w·P × d·P world units.
        // A building mid-pop is drawn by the overlay, so skip it here.
        for (const b of this.tileMap.getBuildings()) {
            if (this.animating.has(buildingKey(b))) continue;
            const voxels = this.assets.get(b.id);
            if (!voxels.length) continue;
            const [fw, fd] = footprintOf(b.id);
            batch.add(voxels, {
                origin: this.cellOrigin(b.ax, b.ay, b.baseLevel),
                rotation: b.rot,
                spanX: fw * CONFIG.voxel.perTile,
                spanY: fd * CONFIG.voxel.perTile
            });
        }
        if (batch.count > 0) this.terrainGroup.add(batch.build());
        this.builtVersion = this.tileMap.terrainVersion;
    }

    /**
     * Fold a freshly-placed building in with an elastic pop, scaled from its
     * footprint center. Excluded from the static mesh while it animates.
     */
    onPlacedBuilding(b: BuildingPlacement): void {
        const voxels = this.assets.get(b.id);
        if (!voxels.length) {
            this.syncTerrain();
            return;
        }
        const [fw, fd] = footprintOf(b.id);
        const [rw, rh] = rotatedFootprint(fw, fd, b.rot);
        const key = buildingKey(b);
        const existing = this.animating.get(key);
        if (existing) {
            this.overlayGroup.remove(existing.group);
            this.disposeObject(existing.group);
        }
        const [ox, , oz] = this.cellOrigin(b.ax, b.ay, b.baseLevel);
        const baseWorldY = -G + b.baseLevel * CONFIG.voxel.size;
        const centerX = ox + (rw * P) / 2;
        const centerZ = oz + (rh * P) / 2;
        const batch = new VoxelBatch(CONFIG.voxel.size);
        batch.add(voxels, {
            origin: [ox - centerX, 0, oz - centerZ],
            rotation: b.rot,
            spanX: fw * CONFIG.voxel.perTile,
            spanY: fd * CONFIG.voxel.perTile
        });
        const group = batch.build();
        group.position.set(centerX, baseWorldY, centerZ);
        group.scale.setScalar(0.001);
        this.overlayGroup.add(group);
        this.animating.set(key, { start: performance.now(), group });
        this.rebuildNow();
    }

    /**
     * Fold a freshly-placed cell in with an elastic pop. The cell is excluded
     * from the static mesh while it animates (so it doesn't double-draw), then
     * baked in when the animation settles.
     */
    onPlaced(gx: number, gy: number): void {
        const cell = this.tileMap.topCell(gx, gy);
        if (!cell) {
            this.syncTerrain();
            return;
        }
        const level = this.tileMap.stackHeight(gx, gy) - 1;
        const baseBelow = this.isGroundAnchored(cell.id)
            ? 0
            : this.columnBaseZ(gx, gy) - this.cellHeight(cell.id);
        const key = `${gx},${gy}:${level}`;
        const existing = this.animating.get(key);
        if (existing) {
            this.overlayGroup.remove(existing.group);
            this.disposeObject(existing.group);
        }

        // Build relative to the cell's base center so the pop scales from there.
        const center = this.cellCenter(gx, gy);
        const [ox, , oz] = this.cellOrigin(gx, gy, baseBelow);
        const baseWorldY = -G + baseBelow * CONFIG.voxel.size;
        const batch = new VoxelBatch(CONFIG.voxel.size);
        batch.add(this.assets.get(cell.id), {
            origin: [ox - center.x, 0, oz - center.z],
            rotation: cell.rot,
            span: CONFIG.voxel.perTile
        });
        const group = batch.build();
        group.position.set(center.x, baseWorldY, center.z);
        group.scale.setScalar(0.001);
        this.overlayGroup.add(group);

        this.animating.set(key, { start: performance.now(), group });
        this.rebuildNow();
    }

    /* ── Hover highlight + ghost preview ──────────────────────── */

    setHover(
        cell: { gx: number; gy: number } | null,
        opts: {
            style: HoverStyle;
            assetId: string | null;
            rotation: Rotation;
            /** Highlight an existing building footprint (e.g. erase preview). */
            region?: BuildingPlacement;
        }
    ): void {
        if (!cell) {
            this.highlight.visible = false;
            this.clearGhost();
            return;
        }
        if (opts.region) {
            // Outline an existing building at its real anchor/footprint.
            const b = opts.region;
            const [fw, fd] = footprintOf(b.id);
            const [rw, rh] = rotatedFootprint(fw, fd, b.rot);
            const [ox, , oz] = this.cellOrigin(b.ax, b.ay);
            const surfaceY = Math.max(0, -G + b.baseLevel * CONFIG.voxel.size);
            this.highlight.position.set(
                ox + (rw * P) / 2,
                surfaceY + 0.06,
                oz + (rh * P) / 2
            );
            this.highlight.scale.set(rw, 1, rh);
            this.highlight.visible = true;
            this.setHighlightColor(HOVER_COLOR[opts.style]);
            this.clearGhost();
            return;
        }
        // A multi-cell building's footprint is anchored at the hovered cell and
        // rests on the level terrain surface; a single tile lands atop its column.
        const [fw, fd] = opts.assetId ? footprintOf(opts.assetId) : [1, 1];
        const multi = fw > 1 || fd > 1;
        const [rw, rh] = multi
            ? rotatedFootprint(fw, fd, opts.rotation)
            : [1, 1];
        const base = multi
            ? this.columnTerrainBaseZ(cell.gx, cell.gy)
            : this.columnBaseZ(cell.gx, cell.gy);
        const surfaceY = Math.max(0, -G + base * CONFIG.voxel.size);

        const [ox, , oz] = this.cellOrigin(cell.gx, cell.gy);
        const centerX = ox + (rw * P) / 2;
        const centerZ = oz + (rh * P) / 2;
        this.highlight.position.set(centerX, surfaceY + 0.06, centerZ);
        this.highlight.scale.set(rw, 1, rh);
        this.highlight.visible = true;
        this.setHighlightColor(HOVER_COLOR[opts.style]);

        this.updateGhost(
            cell,
            opts.style === 'valid' ? opts.assetId : null,
            opts.rotation,
            base
        );
    }

    private setHighlightColor(color: number): void {
        (this.highlightFill.material as THREE.MeshBasicMaterial).color.setHex(
            color
        );
        (this.highlightLine.material as THREE.LineBasicMaterial).color.setHex(
            color
        );
    }

    private updateGhost(
        cell: { gx: number; gy: number },
        assetId: string | null,
        rotation: Rotation,
        base: number
    ): void {
        this.clearGhost();
        if (!assetId) return;
        const voxels = this.assets.get(assetId);
        if (!voxels.length) return;
        const [fw, fd] = footprintOf(assetId);
        const batch = new VoxelBatch(CONFIG.voxel.size);
        batch.add(voxels, {
            origin: this.cellOrigin(
                cell.gx,
                cell.gy,
                this.isGroundAnchored(assetId) ? 0 : base
            ),
            rotation,
            spanX: fw * CONFIG.voxel.perTile,
            spanY: fd * CONFIG.voxel.perTile
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
        this.gridOn = visible;
        this.grid.visible = visible;
    }

    /** Show/hide the scene-builder visuals (hidden while editing a tile). */
    setBuildVisualsVisible(visible: boolean): void {
        this.terrainGroup.visible = visible;
        this.overlayGroup.visible = visible;
        this.substrate.visible = visible;
        this.grid.visible = visible && this.gridOn;
        if (!visible) this.highlight.visible = false;
    }

    /** Frame the whole island (scene-building view). */
    frameBuild(): void {
        const span = W * P;
        this.controls.maxPolarAngle = Math.PI * 0.495; // stay above the island
        this.camera.position.set(span * 0.85, span * 0.7, span * 0.85);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    /**
     * Frame an origin-centered tile (editing view); stops auto-rotate. `cells`
     * is the footprint's larger edge so multi-cell buildings frame fully.
     */
    frameEdit(cells = 1): void {
        const s = Math.max(1, cells);
        this.controls.autoRotate = false;
        // Let the camera dip below the horizon so the tile's underside is visible.
        this.controls.maxPolarAngle = Math.PI;
        this.camera.position.set(P * 1.5 * s, P * 1.4 * s, P * 1.5 * s);
        this.controls.target.set(0, G, 0);
        this.controls.update();
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

/** Animation key for a building pop (anchor is unique per building). */
function buildingKey(b: BuildingPlacement): string {
    return `b:${b.ax},${b.ay}`;
}

/** Elastic-ish overshoot used for the placement pop. */
function easeOutBack(t: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const x = t - 1;
    return 1 + c3 * x * x * x + c1 * x * x;
}
