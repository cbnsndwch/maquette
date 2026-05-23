import { createSampleWorldSpec, GRID_SIZE } from '@cbnsndwch/contracts';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { buildScene, disposeScene } from './build-scene.mjs';

describe('buildScene', () => {
    const spec = createSampleWorldSpec('track:abc');

    it('returns a populated scene with a world group', () => {
        const scene = buildScene(spec);
        const world = scene.getObjectByName('world');
        expect(world).toBeInstanceOf(THREE.Group);
        // One mesh per grid cell, plus any props.
        expect(world!.children.length).toBeGreaterThanOrEqual(
            GRID_SIZE * GRID_SIZE
        );
    });

    it('sets a background color from the palette', () => {
        const scene = buildScene(spec);
        expect(scene.background).toBeInstanceOf(THREE.Color);
    });

    it('adds lighting', () => {
        const scene = buildScene(spec);
        const lights = scene.children.filter(c => c instanceof THREE.Light);
        expect(lights.length).toBeGreaterThan(0);
    });

    it('disposes without throwing', () => {
        const scene = buildScene(spec);
        expect(() => disposeScene(scene)).not.toThrow();
    });
});
