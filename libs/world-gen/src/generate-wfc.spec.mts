import {
    GRID_SIZE,
    PALETTE_SIZE,
    worldSpecSchema,
    type TileType
} from '@cbnsndwch/contracts';
import { describe, expect, it } from 'vitest';

import { deriveKnobs } from './derive.mjs';
import { generateWfcWorld } from './generate-wfc.mjs';
import { TILE_CLASS, type MykonosTile } from './mykonos.mjs';

const BUILT: ReadonlySet<TileType> = new Set<TileType>([
    'wall',
    'rooftop',
    'dome'
]);

function builtCount(tiles: { type: TileType }[][]): number {
    let n = 0;
    for (const row of tiles) {
        for (const { type } of row) {
            if (BUILT.has(type)) {
                n++;
            }
        }
    }
    return n;
}

describe('generateWfcWorld', () => {
    it('produces a spec that satisfies the schema', () => {
        const spec = generateWfcWorld('track:abc');
        expect(() => worldSpecSchema.parse(spec)).not.toThrow();
    });

    it('is deterministic for the same seed', () => {
        expect(generateWfcWorld('track:abc')).toEqual(
            generateWfcWorld('track:abc')
        );
    });

    it('differs across seeds', () => {
        expect(generateWfcWorld('track:abc')).not.toEqual(
            generateWfcWorld('track:xyz')
        );
    });

    it('tags the deterministic paradigm', () => {
        expect(generateWfcWorld('track:abc').paradigm).toBe('wfc');
    });

    it('has the expected grid and palette dimensions', () => {
        const spec = generateWfcWorld('track:abc');
        expect(spec.tiles).toHaveLength(GRID_SIZE);
        expect(spec.tiles[0]).toHaveLength(GRID_SIZE);
        expect(spec.terrain.heightmap).toHaveLength(GRID_SIZE);
        expect(spec.palette).toHaveLength(PALETTE_SIZE);
    });

    it('rings the island in water', () => {
        const spec = generateWfcWorld('track:island');
        const last = GRID_SIZE - 1;
        for (let i = 0; i < GRID_SIZE; i++) {
            expect(spec.tiles[0]![i]!.type).toBe('water');
            expect(spec.tiles[last]![i]!.type).toBe('water');
            expect(spec.tiles[i]![0]!.type).toBe('water');
            expect(spec.tiles[i]![last]!.type).toBe('water');
        }
    });

    it('respects the gradient adjacency rule everywhere', () => {
        const spec = generateWfcWorld('track:adjacency');
        const cls = (x: number, y: number) =>
            TILE_CLASS[spec.tiles[y]![x]!.type as MykonosTile];
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const c = cls(x, y);
                if (x + 1 < GRID_SIZE) {
                    expect(Math.abs(c - cls(x + 1, y))).toBeLessThanOrEqual(1);
                }
                if (y + 1 < GRID_SIZE) {
                    expect(Math.abs(c - cls(x, y + 1))).toBeLessThanOrEqual(1);
                }
            }
        }
    });

    it('builds a denser town for high-energy tracks', () => {
        // Aggregate over several seeds so the comparison is about the feature
        // bias, not the luck of one layout.
        const seeds = ['s1', 's2', 's3', 's4', 's5'];
        let calmTotal = 0;
        let hypeTotal = 0;
        for (const seed of seeds) {
            calmTotal += builtCount(
                generateWfcWorld(seed, {
                    features: {
                        energy: 0.05,
                        acousticness: 0.95,
                        danceability: 0.1
                    }
                }).tiles
            );
            hypeTotal += builtCount(
                generateWfcWorld(seed, {
                    features: {
                        energy: 0.98,
                        acousticness: 0.05,
                        danceability: 0.95
                    }
                }).tiles
            );
        }
        expect(hypeTotal).toBeGreaterThan(calmTotal);
    });

    it('maps mood to time of day', () => {
        const day = deriveKnobs({
            valence: 0.9,
            energy: 0.9,
            danceability: 0.5,
            acousticness: 0.5,
            instrumentalness: 0.5,
            tempo: 120
        });
        const night = deriveKnobs({
            valence: 0.1,
            energy: 0.1,
            danceability: 0.5,
            acousticness: 0.5,
            instrumentalness: 0.5,
            tempo: 120
        });
        expect(day.timeOfDay).toBe('day');
        expect(night.timeOfDay).toBe('night');
    });
});
