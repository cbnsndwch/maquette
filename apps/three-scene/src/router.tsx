import { createBrowserRouter, redirect } from 'react-router';

import { getEngine } from './bootstrap.js';
import { ASSET_INDEX, type TerrainDef } from './config.js';
import { BuildChrome } from './routes/BuildChrome.js';
import { EditorChrome } from './routes/EditorChrome.js';
import { InspectOverlay } from './routes/InspectOverlay.js';
import { RootLayout } from './routes/RootLayout.js';

/** Data returned by the tile-editor loaders (the tile being edited, or null). */
export interface EditorLoaderData {
    def: TerrainDef | null;
}

// Loaders run once per navigation and (unlike effects) are not StrictMode
// double-invoked, so they are the home for the per-navigation imperative engine
// intents — flipping build/edit mode and (re)loading the editor's tile.
//
// Created lazily (not at module load) so the engine is guaranteed initialized
// before the eager initial-route loader runs.
export function createAppRouter(): ReturnType<typeof createBrowserRouter> {
    return createBrowserRouter([
        {
            path: '/',
            element: <RootLayout />,
            children: [
                {
                    index: true,
                    loader: () => {
                        const { game, sceneView } = getEngine();
                        game.setMode('build');
                        // Edited tiles reload their assets; rebuild placed instances.
                        sceneView.invalidateTerrain();
                        sceneView.syncTerrain();
                        return null;
                    },
                    element: <BuildChrome />
                },
                {
                    path: 'tile',
                    loader: (): EditorLoaderData => {
                        const { game, editor } = getEngine();
                        game.setMode('edit');
                        editor.reset();
                        return { def: null };
                    },
                    element: <EditorChrome />
                },
                {
                    path: 'tile/:id',
                    loader: ({ params }): EditorLoaderData => {
                        const { game, editor, assets } = getEngine();
                        const def = ASSET_INDEX[params.id!];
                        if (!def) throw redirect('/tile');
                        game.setMode('edit');
                        editor.loadTile(
                            assets.get(def.id),
                            def.id,
                            assets.palette(def.id)
                        );
                        return { def };
                    },
                    element: <EditorChrome />
                },
                {
                    path: 'inspect',
                    loader: () => {
                        getEngine().game.setMode('build');
                        return null;
                    },
                    element: <InspectOverlay />
                }
            ]
        }
    ]);
}
