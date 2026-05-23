import { createRng, pick, type Rng } from './seed.mjs';
import {
    GRID_SIZE,
    ROTATIONS,
    WORLD_SPEC_VERSION,
    type Prop,
    type PropType,
    type Tile,
    type TileType,
    type WorldSpec
} from './world-spec.mjs';

/**
 * A placeholder, fully-deterministic world generator.
 *
 * It produces a small round island via a radial height falloff plus seeded
 * noise, then assigns tile types by elevation and scatters a few props. This
 * stands in for the real WFC generator (research Stage 2) so the renderer and
 * the rest of the pipeline have a valid {@link WorldSpec} to work against today.
 */

const MYKONOS_PALETTE = [
    '#f4f1ea', // 0 whitewash
    '#1e63b5', // 1 ultramarine (domes / doors)
    '#c66b3d', // 2 terracotta
    '#6b7a3a', // 3 olive
    '#cdbfa3', // 4 dust / rock
    '#e8d9b5', // 5 sand
    '#2f9fb5', // 6 sea
    '#9fd4e0' // 7 sky
] as const;

const LAND_PROPS: readonly PropType[] = [
    'olive-tree',
    'cypress',
    'lamp',
    'pot',
    'well'
];

function tileTypeForHeight(h: number, rng: Rng): TileType {
    if (h < 0.18) {
        return 'water';
    }
    if (h < 0.3) {
        return 'sand';
    }
    if (h < 0.55) {
        return rng() < 0.3 ? 'plaza' : 'grass';
    }
    if (h < 0.75) {
        return rng() < 0.5 ? 'path' : 'rock';
    }
    return rng() < 0.5 ? 'wall' : 'rooftop';
}

export function createSampleWorldSpec(seed: string): WorldSpec {
    const rng = createRng(seed);
    const center = (GRID_SIZE - 1) / 2;
    const maxDist = Math.hypot(center, center);

    const heightmap: number[][] = [];
    const tiles: Tile[][] = [];

    for (let y = 0; y < GRID_SIZE; y++) {
        const hRow: number[] = [];
        const tRow: Tile[] = [];
        for (let x = 0; x < GRID_SIZE; x++) {
            const dist = Math.hypot(x - center, y - center) / maxDist;
            const noise = (rng() - 0.5) * 0.25;
            const h = Math.max(0, Math.min(1, 1 - dist + noise));
            hRow.push(Number(h.toFixed(3)));
            tRow.push({
                type: tileTypeForHeight(h, rng),
                rotation: pick(rng, ROTATIONS)
            });
        }
        heightmap.push(hRow);
        tiles.push(tRow);
    }

    const props: Prop[] = [];
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const tile = tiles[y]?.[x];
            if (!tile) {
                continue;
            }
            const buildable = tile.type === 'grass' || tile.type === 'plaza';
            if (buildable && rng() < 0.12) {
                props.push({
                    type: pick(rng, LAND_PROPS),
                    x,
                    y,
                    scale: 0.8 + rng() * 0.6,
                    rotation: Math.floor(rng() * 360)
                });
            }
        }
    }

    return {
        version: WORLD_SPEC_VERSION,
        seed,
        paradigm: 'wfc',
        biome: 'mykonos',
        palette: [...MYKONOS_PALETTE],
        terrain: { heightmap },
        tiles,
        props,
        weather: pick(rng, ['clear', 'clear', 'cloudy'] as const),
        timeOfDay: pick(rng, ['dawn', 'day', 'day', 'dusk'] as const),
        postFx: {
            kuwahara: false,
            dither: false,
            paletteQuantize: 0,
            toonOutline: false
        }
    };
}
