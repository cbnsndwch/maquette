import { worldSpecSchema } from '@cbnsndwch/contracts';
import { describe, expect, it } from 'vitest';

import { generateWorld } from './biome.mjs';
import {
    DEFAULT_BIOME_ID,
    getBiome,
    hasBiome,
    listBiomes
} from './biome-registry.mjs';
import { cyberpunkBiome } from './biomes/cyberpunk.mjs';
import { mykonosBiome } from './biomes/mykonos.mjs';
import { generateWfcWorld } from './generate-wfc.mjs';

describe('biome registry', () => {
    it('contains the Mykonos + cyberpunk biomes', () => {
        expect(DEFAULT_BIOME_ID).toBe('mykonos');
        expect(hasBiome('mykonos')).toBe(true);
        expect(hasBiome('cyberpunk')).toBe(true);
        expect(listBiomes()).toEqual(
            expect.arrayContaining(['mykonos', 'cyberpunk'])
        );
        expect(getBiome('mykonos')).toBe(mykonosBiome);
        expect(getBiome('cyberpunk')).toBe(cyberpunkBiome);
    });

    it('falls back to the default biome for unknown ids', () => {
        expect(getBiome('does-not-exist')).toBe(mykonosBiome);
    });
});

describe('generateWorld', () => {
    it('tags the world with the biome id', () => {
        const spec = generateWorld('track:abc', mykonosBiome);
        expect(spec.biome).toBe('mykonos');
        expect(() => worldSpecSchema.parse(spec)).not.toThrow();
    });

    it('matches generateWfcWorld for the Mykonos biome', () => {
        expect(generateWorld('track:abc', mykonosBiome)).toEqual(
            generateWfcWorld('track:abc')
        );
    });

    it('only ever uses the biome’s own tile vocabulary', () => {
        const vocab = new Set(mykonosBiome.tiles.map(t => t.id));
        const spec = generateWorld('track:vocab', mykonosBiome);
        for (const row of spec.tiles) {
            for (const tile of row) {
                expect(vocab.has(tile.type)).toBe(true);
            }
        }
    });
});

describe('cyberpunk biome (generalization)', () => {
    const GRID = 14;

    it('produces a schema-valid world from its own vocabulary', () => {
        const spec = generateWfcWorld('track:neon', { biomeId: 'cyberpunk' });
        expect(spec.biome).toBe('cyberpunk');
        expect(() => worldSpecSchema.parse(spec)).not.toThrow();

        const vocab = new Set(cyberpunkBiome.tiles.map(t => t.id));
        for (const row of spec.tiles) {
            for (const tile of row) {
                expect(vocab.has(tile.type)).toBe(true);
            }
        }
        // It uses cyberpunk-exclusive tiles Mykonos doesn't have (proving the
        // abstraction isn't a Mykonos reskin — shared names like 'plaza' aside).
        const mykonos = new Set(mykonosBiome.tiles.map(t => t.id));
        const used = new Set(spec.tiles.flat().map(t => t.type));
        expect(used.has('canal')).toBe(true);
        expect([...used].some(id => !mykonos.has(id))).toBe(true);
    });

    it('rings the city in its border tile (canal)', () => {
        const spec = generateWfcWorld('track:neon', { biomeId: 'cyberpunk' });
        const last = GRID - 1;
        for (let i = 0; i < GRID; i++) {
            expect(spec.tiles[0]![i]!.type).toBe('canal');
            expect(spec.tiles[last]![i]!.type).toBe('canal');
            expect(spec.tiles[i]![0]!.type).toBe('canal');
            expect(spec.tiles[i]![last]!.type).toBe('canal');
        }
    });

    it('is deterministic and distinct from Mykonos', () => {
        const a = generateWfcWorld('track:neon', { biomeId: 'cyberpunk' });
        const b = generateWfcWorld('track:neon', { biomeId: 'cyberpunk' });
        expect(a).toEqual(b);
        expect(a.biome).not.toBe(
            generateWfcWorld('track:neon', { biomeId: 'mykonos' }).biome
        );
    });
});
