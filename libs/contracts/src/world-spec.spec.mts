import { describe, expect, it } from 'vitest';

import { createSampleWorldSpec } from './sample-world.mjs';
import { createRng, seedFromString } from './seed.mjs';
import { GRID_SIZE, PALETTE_SIZE, worldSpecSchema } from './world-spec.mjs';

describe('seed', () => {
    it('is deterministic for the same string', () => {
        expect(seedFromString('track:abc')).toBe(seedFromString('track:abc'));
    });

    it('produces a repeatable sequence', () => {
        const a = createRng('track:abc');
        const b = createRng('track:abc');
        const seqA = [a(), a(), a()];
        const seqB = [b(), b(), b()];
        expect(seqA).toEqual(seqB);
    });

    it('differs across seeds', () => {
        expect(seedFromString('track:abc')).not.toBe(
            seedFromString('track:xyz')
        );
    });
});

describe('createSampleWorldSpec', () => {
    it('produces a spec that satisfies the schema', () => {
        const spec = createSampleWorldSpec('track:abc');
        expect(() => worldSpecSchema.parse(spec)).not.toThrow();
    });

    it('has a square grid of the expected size and palette length', () => {
        const spec = createSampleWorldSpec('track:abc');
        expect(spec.tiles).toHaveLength(GRID_SIZE);
        expect(spec.tiles[0]).toHaveLength(GRID_SIZE);
        expect(spec.terrain.heightmap).toHaveLength(GRID_SIZE);
        expect(spec.palette).toHaveLength(PALETTE_SIZE);
    });

    it('is deterministic for the same seed', () => {
        expect(createSampleWorldSpec('track:abc')).toEqual(
            createSampleWorldSpec('track:abc')
        );
    });
});
