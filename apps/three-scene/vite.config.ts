import { defineConfig } from 'vite';

// Standalone builder app — no API proxy needed (assets are served from public/).
export default defineConfig({
    server: {
        port: 8302
    }
});
