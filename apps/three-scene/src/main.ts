import { Game, type GameUI } from './core/game.js';
import { Input } from './core/input.js';
import { SceneView } from './core/scene-view.js';
import { VoxelAssets } from './core/voxel-assets.js';
import { TileMap } from './grid/tile-map.js';
import { Palette } from './ui/palette.js';
import { renderThumbnails } from './ui/thumbnails.js';
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

    // Collapsible palette panel.
    const paletteEl = document.getElementById('palette')!;
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
