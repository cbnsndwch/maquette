import { defineConfig } from 'vite';

import { palettesController, tilesController } from './vite-tiles-plugin.js';

// Standalone builder app. The tiles/palettes controllers add dev-server
// endpoints that read/write the tile catalog and palette library on disk
// (see vite-tiles-plugin.ts).
export default defineConfig({
    plugins: [tilesController(), palettesController()],
    server: {
        port: 8302
    }
});
