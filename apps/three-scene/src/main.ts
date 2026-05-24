import {
    addTile,
    ASSET_INDEX,
    assetsForCategory,
    loadCatalog,
    removeTile,
    TERRAIN_MANIFEST
} from './config.js';
import { Game, type GameUI } from './core/game.js';
import { Input } from './core/input.js';
import { Router } from './core/router.js';
import { SceneView } from './core/scene-view.js';
import { TileEditor } from './core/tile-editor.js';
import type { TileMeta } from './core/tile-save.js';
import { deleteTile, saveTile } from './core/tile-save.js';
import { VoxelAssets } from './core/voxel-assets.js';
import { TileMap } from './grid/tile-map.js';
import { EditContextMenu } from './ui/edit-context-menu.js';
import { EditorColors } from './ui/editor-colors.js';
import { EditorPanel } from './ui/editor-panel.js';
import { Inspector } from './ui/inspector.js';
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
    const toolbarEl = document.getElementById('toolbar')!;
    const toolbar = new Toolbar(toolbarEl, game);
    const palette = new Palette(
        document.getElementById('palette-accordions')!,
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

    const router = new Router();
    const paletteEl = document.getElementById('palette')!;
    const editorEl = document.getElementById('editor')!;
    const editorColorsEl = document.getElementById('editor-colors')!;

    const editorPanel = new EditorPanel(editorEl, editor, {
        onSave: meta => void onSaveTile(meta),
        onDone: () => router.navigate('/')
    });
    const editorColors = new EditorColors(editorColorsEl, editor);
    const contextMenu = new EditContextMenu(
        sceneView.renderer.domElement,
        game,
        editor
    );
    editor.onChange = () => {
        editorPanel.refresh();
        editorColors.refresh();
        contextMenu.refresh();
    };

    const inspector = new Inspector({
        assets,
        thumbnails,
        onEdit: id => router.navigate(`/tile/${id}`),
        onDelete: id => void onDeleteTile(id),
        onClose: () => router.navigate('/')
    });

    /** Swap the chrome for the active route. */
    function showChrome(view: 'scene' | 'editor' | 'inspect'): void {
        toolbarEl.style.display = view === 'scene' ? '' : 'none';
        paletteEl.style.display = view === 'scene' ? '' : 'none';
        if (view === 'editor') {
            editorPanel.show();
            editorColors.show();
        } else {
            editorPanel.hide();
            editorColors.hide();
        }
        if (view === 'inspect') inspector.show();
        else inspector.hide();
    }

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
        game.setCategory(def.category);
        game.selectAsset(def.id);
        palette.refresh();
        router.navigate('/');
        showToast(`Saved tile "${def.name}"`);
    }

    async function onDeleteTile(id: string): Promise<void> {
        if (!(await deleteTile(id))) {
            showToast('Delete failed');
            return;
        }
        removeTile(id);
        if (game.selectedAssetId === id) {
            const next =
                assetsForCategory(game.category)[0] ?? TERRAIN_MANIFEST[0];
            if (next) game.selectAsset(next.id);
        }
        palette.refresh();
        inspector.refresh();
        showToast('Tile deleted');
    }

    // ── Routes ────────────────────────────────────────────────────
    router
        .register('/', () => {
            game.setMode('build');
            showChrome('scene');
            ui.update();
        })
        .register('/tile', () => {
            game.setMode('edit');
            editor.reset();
            editorPanel.resetMeta();
            showChrome('editor');
        })
        .register('/tile/:id', params => {
            const def = ASSET_INDEX[params.id!];
            if (!def) {
                router.navigate('/tile');
                return;
            }
            game.setMode('edit');
            editor.loadTile(assets.get(def.id), def.id);
            editorPanel.loadMeta(def);
            showChrome('editor');
        })
        .register('/inspect', () => {
            game.setMode('build');
            showChrome('inspect');
        });

    // Palette header → routes.
    document
        .getElementById('palette-tile')!
        .addEventListener('click', () => router.navigate('/tile'));
    document
        .getElementById('palette-inspect')!
        .addEventListener('click', () => router.navigate('/inspect'));

    // Collapsible palette panel.
    const paletteToggle = document.getElementById('palette-toggle')!;
    paletteToggle.addEventListener('click', () => {
        const collapsed = paletteEl.classList.toggle('collapsed');
        paletteToggle.setAttribute('aria-expanded', String(!collapsed));
    });

    // Escape leaves the inspector overlay.
    window.addEventListener('keydown', e => {
        if (e.key === 'Escape' && router.path === '/inspect') {
            router.navigate('/');
        }
    });

    // Restore a previously-saved scene, otherwise start on the empty island.
    game.load();
    sceneView.syncTerrain();
    router.start();
}

void main();
