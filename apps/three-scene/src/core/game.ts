import { assetsForCategory, ASSET_INDEX, type Category } from '../config.js';
import { PlacementSystem } from '../grid/placement-system.js';
import type { Rotation, TerrainState, TileMap } from '../grid/tile-map.js';
import { SaveSystem } from '../storage/save-system.js';
import { downloadSceneVox } from './export-vox.js';
import { History } from './history.js';
import type { SceneView } from './scene-view.js';
import type { TileEditor } from './tile-editor.js';
import type { VoxelAssets } from './voxel-assets.js';

export type Tool = 'place' | 'erase' | 'pan';
export type Mode = 'build' | 'edit';

export interface GameUI {
    update(): void;
    showToast(message: string): void;
}

interface Cell {
    gx: number;
    gy: number;
}

/**
 * Top-level controller. Owns the world (TileMap), placement system, undo/redo
 * history and scene view, and exposes the small intent API consumed by the
 * toolbar, palette and input handler — mirroring the reference app's `Game`.
 */
export class Game {
    tool: Tool = 'place';
    mode: Mode = 'build';
    category: Category = 'terrain';
    selectedAssetId: string;
    /** Brush rotation, preserved globally across placements until changed. */
    rotation: Rotation = 0;
    gridVisible = true;

    private readonly placement: PlacementSystem;
    private readonly history = new History<TerrainState>();
    /** Pre-mutation snapshot captured at the start of a stroke (for undo). */
    private strokeBefore: TerrainState | null = null;
    private lastHover: Cell | null = null;
    ui: GameUI | null = null;
    editor: TileEditor | null = null;
    /** Notified when the build/edit mode changes (UI shows the right panel). */
    onModeChange: ((mode: Mode) => void) | null = null;

    constructor(
        readonly tileMap: TileMap,
        readonly assets: VoxelAssets,
        readonly sceneView: SceneView
    ) {
        this.placement = new PlacementSystem(tileMap);
        this.selectedAssetId = assetsForCategory('terrain')[0]?.id ?? '';
        this.sceneView.setGridVisible(this.gridVisible);
        this.sceneView.setCameraButtons(this.tool);
        this.updateCursor();
    }

    /* ── Tool / selection intents ─────────────────────────────── */

    setTool(t: Tool): void {
        this.tool = t;
        this.sceneView.setCameraButtons(t);
        this.updateCursor();
        this.ui?.update();
    }

    /* ── Build ↔ edit mode ────────────────────────────────────── */

    toggleMode(): void {
        this.setMode(this.mode === 'edit' ? 'build' : 'edit');
    }

    setMode(mode: Mode): void {
        if (this.mode === mode) return;
        this.mode = mode;
        if (mode === 'edit') {
            this.editor?.reset();
            this.editor?.setActive(true);
            this.sceneView.setBuildVisualsVisible(false);
            this.sceneView.setCameraButtons('place'); // free the left button to edit
            this.sceneView.frameEdit();
        } else {
            this.editor?.setActive(false);
            this.sceneView.setBuildVisualsVisible(true);
            this.sceneView.setCameraButtons(this.tool);
            this.sceneView.frameBuild();
        }
        this.updateCursor();
        this.onModeChange?.(mode);
        this.ui?.update();
    }

    /** Forward an editor edit (per-voxel) at a screen pixel. */
    editAt(clientX: number, clientY: number): void {
        this.editor?.editAt(clientX, clientY);
    }

    setCategory(cat: Category): void {
        if (this.category === cat) return;
        this.category = cat;
        const first = assetsForCategory(cat)[0];
        if (first) this.selectedAssetId = first.id;
        this.ui?.update();
    }

    selectAsset(id: string): void {
        const def = ASSET_INDEX[id];
        if (!def) return;
        this.selectedAssetId = id;
        this.category = def.category;
        if (this.tool === 'erase') this.setTool('place');
        else this.ui?.update();
        this.refreshHover();
    }

    /** Cycle the brush rotation (delta 1 = +90°, 3 = −90°). Stays selected. */
    rotateBrush(delta: Rotation = 1): void {
        this.rotation = ((((this.rotation + delta) % 4) + 4) % 4) as Rotation;
        this.refreshHover();
        this.ui?.update();
    }

    toggleGrid(): void {
        this.gridVisible = !this.gridVisible;
        this.sceneView.setGridVisible(this.gridVisible);
        this.ui?.update();
    }

    toggleAutoRotate(): void {
        this.sceneView.setAutoRotate(!this.sceneView.autoRotate);
        this.ui?.update();
    }

    get autoRotate(): boolean {
        return this.sceneView.autoRotate;
    }

    /* ── Persistence + history ────────────────────────────────── */

    save(): void {
        this.ui?.showToast(
            SaveSystem.save(this.tileMap) ? 'Saved your scene' : 'Save failed'
        );
    }

    load(): boolean {
        const ok = SaveSystem.load(this.tileMap);
        if (ok) this.sceneView.syncTerrain();
        return ok;
    }

    /** Export the whole scene as a downloadable MagicaVoxel `.vox` file. */
    exportScene(): void {
        const count = downloadSceneVox(this.tileMap, this.assets);
        this.ui?.showToast(
            count > 0
                ? `Exported ${count} voxels to scene.vox`
                : 'Nothing to export'
        );
    }

    reset(): void {
        this.beginStroke();
        this.tileMap.clearAll();
        SaveSystem.clear();
        this.sceneView.syncTerrain();
        this.endStroke();
        this.ui?.showToast('Scene reset');
    }

    /** Carpet every empty cell with the selected terrain at the current rotation. */
    fillTerrain(): void {
        const id = this.selectedAssetId;
        if (!ASSET_INDEX[id]) return;
        this.beginStroke();
        let filled = 0;
        for (let gy = 0; gy < this.tileMap.height; gy++) {
            for (let gx = 0; gx < this.tileMap.width; gx++) {
                if (this.tileMap.stackHeight(gx, gy) > 0) continue;
                if (this.placement.place(id, gx, gy, this.rotation)) filled++;
            }
        }
        this.sceneView.syncTerrain();
        this.endStroke();
        this.ui?.showToast(
            filled > 0
                ? `Filled ${filled} ${filled === 1 ? 'cell' : 'cells'} with ${id}`
                : 'Grid already covered'
        );
    }

    /** Begin grouping mutations into a single undo step. */
    beginStroke(): void {
        if (!this.strokeBefore) this.strokeBefore = this.tileMap.snapshot();
    }

    /** Commit the grouped mutations as one undo step (only if anything changed). */
    endStroke(): void {
        if (!this.strokeBefore) return;
        const before = this.strokeBefore;
        this.strokeBefore = null;
        if (changed(before, this.tileMap.snapshot())) {
            this.history.record(before);
            this.ui?.update();
        }
    }

    undo(): void {
        const prev = this.history.undo(this.tileMap.snapshot());
        if (!prev) return;
        this.tileMap.restore(prev);
        this.sceneView.syncTerrain();
        this.refreshHover();
        this.ui?.update();
    }

    redo(): void {
        const next = this.history.redo(this.tileMap.snapshot());
        if (!next) return;
        this.tileMap.restore(next);
        this.sceneView.syncTerrain();
        this.refreshHover();
        this.ui?.update();
    }

    get canUndo(): boolean {
        return this.history.canUndo;
    }

    get canRedo(): boolean {
        return this.history.canRedo;
    }

    /* ── Input callbacks ──────────────────────────────────────── */

    onHover(cell: Cell | null): void {
        this.lastHover = cell;
        if (!cell) {
            this.sceneView.setHover(null, {
                style: 'valid',
                assetId: null,
                rotation: 0
            });
            return;
        }
        if (this.tool === 'erase') {
            const has = this.tileMap.stackHeight(cell.gx, cell.gy) > 0;
            this.sceneView.setHover(cell, {
                style: has ? 'erase' : 'invalid',
                assetId: null,
                rotation: this.rotation
            });
        } else if (this.tool === 'place') {
            const valid = this.placement.canPlace(
                this.selectedAssetId,
                cell.gx,
                cell.gy
            );
            this.sceneView.setHover(cell, {
                style: valid ? 'valid' : 'invalid',
                assetId: this.selectedAssetId,
                rotation: this.rotation
            });
        } else {
            // Pan tool: no placement preview, just the cell outline.
            this.sceneView.setHover(cell, {
                style: 'valid',
                assetId: null,
                rotation: 0
            });
        }
    }

    onPrimaryClick(gx: number, gy: number): void {
        if (!this.tileMap.inBounds(gx, gy)) return;
        if (this.tool === 'erase') {
            if (this.placement.erase(gx, gy)) this.sceneView.syncTerrain();
        } else if (this.tool === 'place') {
            if (
                this.placement.place(
                    this.selectedAssetId,
                    gx,
                    gy,
                    this.rotation
                )
            ) {
                this.sceneView.onPlaced(gx, gy);
            }
        }
    }

    /** Right-click / dedicated erase, regardless of the active tool. */
    eraseCell(gx: number, gy: number): void {
        if (this.placement.erase(gx, gy)) this.sceneView.syncTerrain();
    }

    /** Re-emit the hover preview at the last cell (after rotation / undo). */
    private refreshHover(): void {
        if (this.lastHover) this.onHover(this.lastHover);
    }

    private updateCursor(): void {
        this.sceneView.renderer.domElement.style.cursor =
            this.tool === 'pan' ? 'grab' : 'crosshair';
    }
}

/** True when two terrain snapshots differ (per-column stacks). */
function changed(a: TerrainState, b: TerrainState): boolean {
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) {
        const sa = a[i] ?? [];
        const sb = b[i] ?? [];
        if (sa.length !== sb.length) return true;
        for (let j = 0; j < sa.length; j++) {
            if (sa[j]!.id !== sb[j]!.id || sa[j]!.rot !== sb[j]!.rot) {
                return true;
            }
        }
    }
    return false;
}
