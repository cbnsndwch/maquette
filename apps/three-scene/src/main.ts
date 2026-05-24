import { addTile, loadCatalog } from './config.js';
import { Game, type GameUI } from './core/game.js';
import { Input } from './core/input.js';
import { SceneView } from './core/scene-view.js';
import { TileEditor } from './core/tile-editor.js';
import type { TileMeta } from './core/tile-save.js';
import { saveTile } from './core/tile-save.js';
import { VoxelAssets } from './core/voxel-assets.js';
import { TileMap } from './grid/tile-map.js';
import { EditorPanel } from './ui/editor-panel.js';
import { Palette } from './ui/palette.js';
import { renderThumbnail, renderThumbnails } from './ui/thumbnails.js';
import { Toolbar } from './ui/toolbar.js';

const appEl = document.getElementById('app')!;
const toastEl = document.getElementById('toast')!;

let toastTimer: number | undefined;
function showToast(message: string): void {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(
        () => toastEl.classList.remove('show'),
        1800
    );
}

async function main(): Promise<void> {
    await loadCatalog();
    const assets = new VoxelAssets();
    await assets.preload();

    const tileMap = new TileMap();
    const sceneView = new SceneView(appEl, tileMap, assets);
    const game = new Game(tileMap, assets, sceneView);

    const thumbnails = renderThumbnails(assets);
    const toolbar = new Toolbar(document.getElementById('toolbar')!, game);
    const palette = new Palette(
        document.getElementById('palette-tabs')!,
        document.getElementById('palette-grid')!,
        game,
        thumbnails
    );

    const ui: GameUI = {
        update: () => {
            toolbar.update();
            palette.update();
        },
        showToast
    };
    game.ui = ui;

    new Input(sceneView.renderer.domElement, game);

    // ── Tile editor mode ──────────────────────────────────────────
    const editor = new TileEditor(sceneView);
    game.editor = editor;

    const toolbarEl = document.getElementById('toolbar')!;
    const paletteEl = document.getElementById('palette')!;
    const editorEl = document.getElementById('editor')!;

    async function onSaveTile(meta: TileMeta): Promise<void> {
        if (editor.voxels.length === 0) {
            showToast('Add some voxels first');
            return;
        }
        const def = await saveTile(meta, editor.voxels);
        if (!def) {
            showToast('Save failed');
            return;
        }
        addTile(def);
        await assets.loadOne(def.id, def.file);
        const thumb = renderThumbnail(assets, def.id);
        if (thumb) palette.setThumbnail(def.id, thumb);
        game.setMode('build');
        game.setCategory(def.category);
        game.selectAsset(def.id);
        palette.refresh();
        showToast(`Saved tile "${def.name}"`);
    }

    const editorPanel = new EditorPanel(editorEl, editor, {
        onSave: meta => void onSaveTile(meta),
        onDone: () => game.setMode('build')
    });
    editorPanel.hide();

    // Swap the build chrome for the editor panel when the mode changes.
    game.onModeChange = mode => {
        const editing = mode === 'edit';
        toolbarEl.style.display = editing ? 'none' : '';
        paletteEl.style.display = editing ? 'none' : '';
        if (editing) editorPanel.show();
        else editorPanel.hide();
    };

    // Collapsible palette panel.
    const paletteToggle = document.getElementById('palette-toggle')!;
    paletteToggle.addEventListener('click', () => {
        const collapsed = paletteEl.classList.toggle('collapsed');
        paletteToggle.setAttribute('aria-expanded', String(!collapsed));
    });

    // Restore a previously-saved scene, otherwise start on the empty island.
    game.load();
    sceneView.syncTerrain();
    ui.update();
}

void main();
