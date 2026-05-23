import { defineConfig } from 'tsup';

export default defineConfig({
    bundle: true,
    clean: true,
    dts: false,
    sourcemap: false,
    platform: 'node',
    outDir: 'dist',
    format: ['esm'],
    external: [
        '@cbnsndwch/contracts',
        '@cbnsndwch/world-gen',
        // @opentui/core and @opentui/three are Bun-first packages with native
        // Zig FFI bindings — leave them unresolved so Bun picks them up at
        // runtime (they throw if the process isn't Bun / WebGPU isn't available,
        // and main.mts catches that and falls back to the 2D ASCII renderer).
        '@opentui/core',
        '@opentui/three',
        'three'
    ],
    entry: ['src/main.mts', 'src/ascii.mts', 'src/render3d.mts']
});
