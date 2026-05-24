import { defineConfig } from 'tsup';

export default defineConfig({
    bundle: true,
    clean: true,
    dts: false,
    sourcemap: true,
    platform: 'node',
    target: 'node22',
    outDir: 'dist',
    format: ['esm'],
    banner: { js: '#!/usr/bin/env node' },
    external: [
        '@cbnsndwch/scene-author',
        '@cbnsndwch/world-core',
        '@modelcontextprotocol/sdk',
        'zod',
        /^three($|\/)/
    ],
    entry: ['src/index.mts']
});
