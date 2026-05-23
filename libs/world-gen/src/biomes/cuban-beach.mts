import {
    GRID_SIZE,
    pick,
    type AudioFeatures,
    type Prop,
    type Rng
} from '@cbnsndwch/contracts';

import {
    gradientAdjacency,
    type Biome,
    type BiomeKnobs,
    type BiomeTile
} from '../biome.mjs';

/**
 * The Cuban Beach biome — turquoise Caribbean shore lined with palm shacks,
 * fishing boats, and sun-bleached sand. The gradient mechanic runs from open sea
 * through shore and dune scrub up to thatch-roof shacks, giving the WFC engine a
 * warm, tropical coastal vocabulary.
 */

type CubanBeachKind = 'border' | 'shore' | 'ground' | 'built' | 'crown';

interface CubanBeachTile extends BiomeTile {
    baseWeight: number;
    kind: CubanBeachKind;
}

const TILES: readonly CubanBeachTile[] = [
    { id: 'sea', cls: 0, height: 0.05, baseWeight: 0.5, kind: 'border' },
    { id: 'shore', cls: 1, height: 0.15, baseWeight: 1.0, kind: 'shore' },
    { id: 'sand', cls: 1, height: 0.2, baseWeight: 1.6, kind: 'shore' },
    {
        id: 'beach-grass',
        cls: 2,
        height: 0.32,
        baseWeight: 2.4,
        kind: 'ground'
    },
    { id: 'dune', cls: 2, height: 0.38, baseWeight: 1.2, kind: 'ground' },
    { id: 'path', cls: 2, height: 0.34, baseWeight: 1.0, kind: 'ground' },
    { id: 'palm-base', cls: 3, height: 0.5, baseWeight: 1.6, kind: 'built' },
    { id: 'shack-floor', cls: 3, height: 0.55, baseWeight: 1.0, kind: 'built' },
    { id: 'shack', cls: 4, height: 0.75, baseWeight: 1.2, kind: 'built' },
    { id: 'thatch-roof', cls: 4, height: 0.88, baseWeight: 0.6, kind: 'crown' }
];

/** Warm Caribbean palette: sea-foam and turquoise against bone-white sand and terracotta. */
const PALETTE = [
    '#f5e6c8', // 0 sand-cream
    '#1ec8c8', // 1 turquoise-sea
    '#d97942', // 2 terracotta
    '#3e8e41', // 3 palm-green
    '#c9a875', // 4 thatch
    '#fff5e8', // 5 shell-white
    '#2ba7b0', // 6 lagoon
    '#f4d35e' // 7 sun-yellow
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    'beach-grass': ['palm-tree'],
    dune: ['palm-tree'],
    'palm-base': ['palm-tree', 'hammock'],
    'shack-floor': ['conga-drum', 'tiki-torch'],
    path: ['tiki-torch'],
    sand: ['fishing-net', 'driftwood'],
    shore: ['fishing-net', 'driftwood', 'conch-shell'],
    sea: [] // handled contextually below
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

function deriveWeights(f: AudioFeatures): number[] {
    // higher energy → more shack/path weight; lower → more sand/shore
    const built = 0.5 + f.energy * 1.6;
    // higher danceability → more shack-floor (more dance spots)
    const dance = 0.5 + f.danceability * 1.5;
    // lower energy slightly lifts open shore/sand
    const open = 0.6 + (1 - f.energy) * 0.8;

    return TILES.map(t => {
        let factor = 1;
        if (t.id === 'shack' || t.id === 'thatch-roof' || t.id === 'path') {
            factor = built;
        } else if (t.id === 'shack-floor') {
            factor = dance;
        } else if (t.kind === 'shore') {
            factor = open;
        }
        return Math.max(0.01, t.baseWeight * factor);
    });
}

function deriveTimeOfDay(f: AudioFeatures): 'day' | 'dawn' | 'dusk' {
    // Sunny tropical biome — never 'night'
    if (f.valence >= 0.65) {
        return 'day';
    }
    if (f.valence >= 0.4) {
        return 'dawn';
    }
    return 'dusk';
}

function deriveWeather(f: AudioFeatures): 'clear' | 'rain' {
    // Keep it mostly clear; only rain at low energy + low valence
    if (f.energy < 0.35 && f.valence < 0.4) {
        return 'rain';
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

            if (choices && choices.length > 0 && rng() < propDensity) {
                props.push({
                    type: pick(rng, choices),
                    x,
                    y,
                    scale: Number((0.8 + rng() * 0.6).toFixed(3)),
                    rotation: Math.floor(rng() * 360)
                });
            }

            // A fishing boat bobs on sea cells that touch shore or sand.
            if (
                type === 'sea' &&
                rng() < 0.04 &&
                (touches(tiles, x, y, 'shore') || touches(tiles, x, y, 'sand'))
            ) {
                props.push({
                    type: 'fishing-boat',
                    x,
                    y,
                    scale: Number((0.7 + rng() * 0.4).toFixed(3)),
                    rotation: Math.floor(rng() * 360)
                });
            }
        }
    }

    return props;
}

export const cubanBeachBiome: Biome = {
    id: 'cuban-beach',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'sea',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            // higher tempo → denser props, clamped 0.08..0.22
            propDensity: clamp(0.08 + (features.tempo / 120) * 0.07, 0.08, 0.22)
        };
    },
    placeProps
};
