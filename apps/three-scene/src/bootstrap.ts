import { toast } from 'sonner';

import { TileMap } from '@cbnsndwch/scene-author';

import { loadCatalog } from './config.js';
import { Game } from './core/game.js';
import { Input } from './core/input.js';
import { SceneView } from './core/scene-view.js';
import { TileEditor } from './core/tile-editor.js';
import { VoxelAssets } from './core/voxel-assets.js';
import { renderThumbnails } from './ui/thumbnails.js';
import { emit } from './store.js';

/**
 * The imperative Three.js engine, created once and shared with React.
 */
export interface Engine {
    tileMap: TileMap;
    assets: VoxelAssets;
    sceneView: SceneView;
    game: Game;
    editor: TileEditor;

    /**
     * id → isometric PNG data URL,
     * rendered once at boot for palette swatches.
     */
    thumbnails: Map<string, string>;
}

// Preserve the singleton across HMR updates of this module so editing it never
// spins up a second WebGL context. The renderer's canvas lives detached until
// <SceneCanvas/> re-parents it into the DOM, so it survives module re-execution.
let engine: Engine | undefined = import.meta.hot?.data.engine as
    | Engine
    | undefined;

let initPromise: Promise<Engine> | undefined;

async function create(): Promise<Engine> {
    await loadCatalog();

    const assets = new VoxelAssets();
    await assets.preload();

    const tileMap = new TileMap();

    // The canvas starts in a detached container; <SceneCanvas/> appends the
    // renderer's domElement into the React-managed mount on first effect.
    const sceneView = new SceneView(
        document.createElement('div'),
        tileMap,
        assets
    );
    const editor = new TileEditor(sceneView);

    const game = new Game(tileMap, assets, sceneView);
    game.editor = editor;

    // Input attaches its pointer/keyboard listeners to the persistent canvas,
    // so they live for the lifetime of the page (the canvas never unmounts).
    new Input(sceneView.renderer.domElement, game);

    // Route the engine's existing single-callback contract into the React store.
    // sonner's toast() is callable outside React, so the engine fires toasts too.
    editor.onChange = emit;
    game.ui = { update: emit, showToast: m => toast(m) };

    const thumbnails = renderThumbnails(assets);

    // Restore a previously-saved scene (no-op if none); the index route loader
    // handles per-navigation terrain sync.
    game.load();
    sceneView.syncTerrain();

    return { tileMap, assets, sceneView, game, editor, thumbnails };
}

/**
 * Initialize the engine once; subsequent calls return the same instance.
 */
export function initEngine(): Promise<Engine> {
    if (engine) {
        return Promise.resolve(engine);
    }

    initPromise ??= create().then(e => {
        engine = e;
        if (import.meta.hot) {
            import.meta.hot.data.engine = e;
        }

        return e;
    });

    return initPromise;
}

/**
 * Get the initialized engine (throws if {@link initEngine} hasn't resolved).
 */
export function getEngine(): Engine {
    if (!engine) {
        throw new Error('Engine not initialized — call initEngine()');
    }

    return engine;
}
