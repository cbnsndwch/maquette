import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { palettesController, tilesController } from './vite-tiles-plugin.js';

// Standalone builder app. The tiles/palettes controllers add dev-server
// endpoints that read/write the tile catalog and palette library on disk
// (see vite-tiles-plugin.ts).
export default defineConfig({
    plugins: [react(), tailwindcss(), tilesController(), palettesController()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    },
    server: {
        port: 8302,
        watch: {
            // Ignore files written by the tiles/palettes controllers so Vite
            // does not trigger a full reload when a tile is saved or deleted.
            ignored: ['**/public/voxels/**']
        }
    }
});
