import {
    GRID_SIZE,
    pick,
    type AudioFeatures,
    type Prop,
    type Rng,
    type TimeOfDay,
    type Weather
} from '@cbnsndwch/contracts';

import {
    gradientAdjacency,
    type Biome,
    type BiomeKnobs,
    type BiomeTile
} from '../biome.mjs';

/**
 * The nordic-fjord biome — a cold Norwegian fjord wall of water, basalt, pine,
 * and aurora light. Nordic folk keeps it mossy and human; black metal raises
 * cliffs and icy crowns. Medium-low energy, medium valence, polar-night +
 * aurora-mint palette.
 */

type NordicKind =
    | 'border'
    | 'transition'
    | 'ground'
    | 'nature'
    | 'circulation'
    | 'hillside'
    | 'built'
    | 'social'
    | 'crown';

interface NordicTile extends BiomeTile {
    baseWeight: number;
    kind: NordicKind;
}

const TILES: readonly NordicTile[] = [
    {
        id: 'fjord-water',
        cls: 0,
        height: 0.04,
        baseWeight: 0.45,
        kind: 'border'
    },
    {
        id: 'pebble-shore',
        cls: 1,
        height: 0.14,
        baseWeight: 1.0,
        kind: 'transition'
    },
    { id: 'moss-field', cls: 2, height: 0.3, baseWeight: 1.8, kind: 'ground' },
    { id: 'pine-stand', cls: 2, height: 0.38, baseWeight: 1.7, kind: 'nature' },
    {
        id: 'turf-path',
        cls: 2,
        height: 0.34,
        baseWeight: 0.9,
        kind: 'circulation'
    },
    {
        id: 'black-cliff',
        cls: 3,
        height: 0.62,
        baseWeight: 1.7,
        kind: 'hillside'
    },
    { id: 'turf-cabin', cls: 3, height: 0.58, baseWeight: 0.8, kind: 'built' },
    { id: 'runestone', cls: 3, height: 0.66, baseWeight: 0.6, kind: 'social' },
    { id: 'snow-ridge', cls: 4, height: 0.86, baseWeight: 1.0, kind: 'crown' },
    { id: 'aurora-peak', cls: 4, height: 0.98, baseWeight: 0.45, kind: 'crown' }
];

/** Polar-night base with aurora-mint and snow accents. */
const PALETTE = [
    '#07131f', // 0 polar-night
    '#1f4e5f', // 1 fjord-blue
    '#6f7d6b', // 2 lichen-gray
    '#263b2c', // 3 pine-green
    '#dfe7ea', // 4 snow
    '#2b2b2f', // 5 basalt
    '#8a5f3d', // 6 turf-brown
    '#7fe7d7' // 7 aurora-mint
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    'pine-stand': ['pine-tree'],
    'moss-field': ['pine-tree'],
    'fjord-water': ['longboat'],
    'pebble-shore': ['longboat'],
    runestone: ['rune-marker', 'torch'],
    'turf-path': ['rune-marker'],
    'turf-cabin': ['smoke-plume', 'torch'],
    'snow-ridge': ['snow-drift'],
    'aurora-peak': ['snow-drift']
};

function deriveWeights(f: AudioFeatures): number[] {
    const vertical = 0.5 + f.energy * 1.6; // energy → cliffs, crowns
    const soft = 0.5 + f.danceability * 1.4; // danceability → paths, fields
    const built = 0.4 + f.energy * 1.2; // energy → cabins/runestones
    return TILES.map(t => {
        let factor = 1;
        if (t.kind === 'hillside' || t.kind === 'crown') {
            factor = vertical;
        } else if (t.kind === 'ground' || t.kind === 'circulation') {
            factor = soft;
        } else if (t.kind === 'built' || t.kind === 'social') {
            factor = built;
        }
        return Math.max(0.01, t.baseWeight * factor);
    });
}

function deriveTimeOfDay(f: AudioFeatures): TimeOfDay {
    if (f.valence >= 0.6) {
        return 'dawn';
    }
    if (f.valence >= 0.35) {
        return 'day';
    }
    return 'night';
}

function deriveWeather(f: AudioFeatures): Weather {
    if (f.energy < 0.35) {
        return 'fog';
    }
    if (f.energy > 0.6 && f.valence < 0.4) {
        return 'fog';
    }
    return 'clear';
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

function placeProps(tiles: string[][], propDensity: number, rng: Rng): Prop[] {
    const props: Prop[] = [];
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const type = tiles[y]![x]!;
            const choices = PROPS_BY_TILE[type];
            if (choices && rng() < propDensity) {
                props.push({
                    type: pick(rng, choices),
                    x,
                    y,
                    scale: Number((0.8 + rng() * 0.7).toFixed(3)),
                    rotation: Math.floor(rng() * 360)
                });
            }
        }
    }
    return props;
}

export const nordicFjordBiome: Biome = {
    id: 'nordic-fjord',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'fjord-water',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            // Sparse (0.06..0.16) — fjord landscape is wide and open
            propDensity: clamp(0.06 + (features.tempo / 120) * 0.07, 0.06, 0.16)
        };
    },
    placeProps
};
