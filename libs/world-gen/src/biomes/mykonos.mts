import {
    GRID_SIZE,
    ROTATIONS,
    TILE_TYPES,
    pick,
    type AudioFeatures,
    type Prop,
    type PropType,
    type Rng,
    type Structure
} from '@cbnsndwch/contracts';

import {
    gradientAdjacency,
    type Biome,
    type BiomeKnobs,
    type BiomeTile
} from '../biome.mjs';
import { deriveKnobs } from '../derive.mjs';
import {
    PALETTES,
    TILE_CLASS,
    TILE_HEIGHT,
    type MykonosTile
} from '../mykonos.mjs';

/**
 * The Mykonos biome — sun-bleached Cycladic island (biome #1). Composes the
 * Mykonos tile catalog (`mykonos.mts`) and feature mapping (`derive.mts`) behind
 * the generic {@link Biome} interface.
 */

/** Props that suit each kind of buildable ground. */
const PROPS_BY_TILE: Partial<Record<MykonosTile, readonly PropType[]>> = {
    grass: [
        'olive-tree',
        'cypress',
        'bougainvillea',
        'bougainvillea',
        'agave',
        'pot',
        'cypress'
    ],
    plaza: ['bench', 'lamp', 'bougainvillea', 'pot', 'cypress', 'agave'],
    path: ['lamp', 'bench', 'pot']
};

function touches(
    tiles: string[][],
    x: number,
    y: number,
    type: string
): boolean {
    const deltas = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
    ] as const;
    for (const [dx, dy] of deltas) {
        if (tiles[y + dy]?.[x + dx] === type) {
            return true;
        }
    }
    return false;
}

function placeProps(tiles: string[][], propDensity: number, rng: Rng): Prop[] {
    const props: Prop[] = [];

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const type = tiles[y]![x]! as MykonosTile;
            const choices = PROPS_BY_TILE[type];
            if (choices && rng() < propDensity) {
                props.push({
                    type: pick(rng, choices),
                    x,
                    y,
                    scale: Number((0.8 + rng() * 0.6).toFixed(3)),
                    rotation: Math.floor(rng() * 360)
                });
            }

            // A rare windmill crowns the high built tiles.
            if (type === 'wall' && rng() < 0.05) {
                props.push({
                    type: 'windmill',
                    x,
                    y,
                    scale: Number((1.1 + rng() * 0.4).toFixed(3)),
                    rotation: Math.floor(rng() * 360)
                });
            }

            // A boat bobs on water that touches the beach.
            if (
                type === 'water' &&
                rng() < 0.03 &&
                touches(tiles, x, y, 'sand')
            ) {
                props.push({
                    type: 'boat',
                    x,
                    y,
                    scale: Number((0.7 + rng() * 0.3).toFixed(3)),
                    rotation: Math.floor(rng() * 360)
                });
            }
        }
    }

    return props;
}

/** Composite buildings and their square footprints (in tiles). */
const STRUCTURE_CATALOG: ReadonlyArray<{ type: string; footprint: number }> = [
    { type: 'cube-house', footprint: 2 },
    { type: 'cube-house', footprint: 2 },
    { type: 'cube-house', footprint: 2 },
    { type: 'two-story', footprint: 3 },
    { type: 'two-story', footprint: 3 },
    { type: 'chapel', footprint: 2 },
    { type: 'villa', footprint: 4 },
    { type: 'windmill', footprint: 2 }
];

const BUILDABLE: ReadonlySet<string> = new Set([
    'grass',
    'plaza',
    'sand',
    'path',
    'rock'
]);

/** Place a cluster of multi-cell white buildings on open, flat ground. */
function placeStructures(
    tileIds: string[][],
    features: AudioFeatures,
    rng: Rng
): Structure[] {
    const used = new Set<string>();
    const structures: Structure[] = [];

    const fits = (x: number, y: number, fp: number): boolean => {
        if (
            x < 1 ||
            y < 1 ||
            x + fp > GRID_SIZE - 1 ||
            y + fp > GRID_SIZE - 1
        ) {
            return false;
        }
        for (let dy = 0; dy < fp; dy++) {
            for (let dx = 0; dx < fp; dx++) {
                const t = tileIds[y + dy]?.[x + dx];
                if (t === undefined || !BUILDABLE.has(t)) return false;
                if (used.has(`${x + dx},${y + dy}`)) return false;
            }
        }
        return true;
    };
    const reserve = (x: number, y: number, fp: number): void => {
        for (let dy = 0; dy < fp; dy++) {
            for (let dx = 0; dx < fp; dx++) used.add(`${x + dx},${y + dy}`);
        }
    };

    const target = Math.round(7 + features.danceability * 7);
    for (
        let attempts = 0;
        structures.length < target && attempts < 600;
        attempts++
    ) {
        const b = pick(rng, STRUCTURE_CATALOG);
        const x = 1 + Math.floor(rng() * (GRID_SIZE - 2));
        const y = 1 + Math.floor(rng() * (GRID_SIZE - 2));
        if (!fits(x, y, b.footprint)) continue;
        reserve(x, y, b.footprint);
        structures.push({
            type: b.type,
            x,
            y,
            footprint: b.footprint,
            rotation: pick(rng, ROTATIONS)
        });
    }
    return structures;
}

export const mykonosBiome: Biome = {
    id: 'mykonos',
    tiles: TILE_TYPES.map(
        (id): BiomeTile => ({
            id,
            cls: TILE_CLASS[id],
            height: TILE_HEIGHT[id]
        })
    ),
    borderTileId: 'water',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        // Mykonos is iconically sun-bleached: keep music-driven layout/density
        // but render it in bright, clear daylight.
        const knobs = deriveKnobs(features);
        return {
            ...knobs,
            timeOfDay: 'day',
            weather: 'clear',
            palette: [...PALETTES.day],
            propDensity: Math.max(0.16, knobs.propDensity)
        };
    },
    placeProps,
    placeStructures
};
