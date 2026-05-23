import { defineConfig } from 'tsup';

export default defineConfig({
    bundle: true,
    clean: true,
    dts: true,
    sourcemap: true,
    platform: 'neutral',
    outDir: 'dist',
    format: ['esm'],
    external: ['zod'],
    entry: ['src/index.mts']
});
