import { defineConfig } from 'vite';

import { tilesController } from './vite-tiles-plugin.js';

// Standalone builder app. The tiles controller adds dev-server endpoints that
// read/write the tile catalog on disk (see vite-tiles-plugin.ts).
export default defineConfig({
    plugins: [tilesController()],
    server: {
        port: 8302
    }
});
