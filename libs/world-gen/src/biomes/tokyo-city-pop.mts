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
 * The tokyo-city-pop biome — a glossy Shibuya-inspired district with crossings,
 * record shops, vending glow, towers, and rooftop signs. J-pop, city pop, and
 * vaporwave filtered through anime night streets. Lighter and warmer than
 * cyberpunk — indigo-night base with pink-neon, aqua, and gold rather than
 * near-black neons.
 */

type TokyoKind =
    | 'border'
    | 'transition'
    | 'circulation'
    | 'ground'
    | 'social'
    | 'built'
    | 'crown';

interface TokyoTile extends BiomeTile {
    baseWeight: number;
    kind: TokyoKind;
}

const TILES: readonly TokyoTile[] = [
    {
        id: 'metro-moat',
        cls: 0,
        height: 0.06,
        baseWeight: 0.35,
        kind: 'border'
    },
    {
        id: 'station-edge',
        cls: 1,
        height: 0.18,
        baseWeight: 0.9,
        kind: 'transition'
    },
    {
        id: 'crosswalk',
        cls: 2,
        height: 0.3,
        baseWeight: 1.8,
        kind: 'circulation'
    },
    { id: 'sidewalk', cls: 2, height: 0.32, baseWeight: 2.0, kind: 'ground' },
    {
        id: 'record-shop',
        cls: 2,
        height: 0.38,
        baseWeight: 1.1,
        kind: 'social'
    },
    { id: 'konbini', cls: 3, height: 0.56, baseWeight: 1.0, kind: 'built' },
    {
        id: 'billboard-block',
        cls: 3,
        height: 0.7,
        baseWeight: 1.5,
        kind: 'built'
    },
    {
        id: 'apartment-stack',
        cls: 3,
        height: 0.66,
        baseWeight: 1.2,
        kind: 'built'
    },
    {
        id: 'rooftop-sign',
        cls: 4,
        height: 0.86,
        baseWeight: 0.9,
        kind: 'crown'
    },
    { id: 'tower-screen', cls: 4, height: 0.96, baseWeight: 0.5, kind: 'crown' }
];

/**
 * Indigo-night base with pink-neon, aqua-screen, city-gold, and violet — lighter
 * and warmer than cyberpunk's near-black-and-magenta palette.
 */
const PALETTE = [
    '#16162a', // 0 indigo-night
    '#ff6fb1', // 1 pink-neon
    '#45d6ff', // 2 aqua-screen
    '#f6d365', // 3 city-gold
    '#7b61ff', // 4 violet-glow
    '#f3f3f5', // 5 crosswalk-white
    '#2b3045', // 6 asphalt
    '#4ff0b0' // 7 mint-light
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    sidewalk: ['vending-machine', 'street-bike'],
    'station-edge': ['street-bike'],
    konbini: ['vending-machine'],
    crosswalk: ['traffic-light'],
    'record-shop': ['vinyl-crate'],
    'billboard-block': ['neon-kanban'],
    'rooftop-sign': ['neon-kanban'],
    'tower-screen': ['capsule-sign']
};

function deriveWeights(f: AudioFeatures): number[] {
    const urban = 0.5 + f.energy * 1.6; // energy → billboards, towers, screens
    const social = 0.5 + f.danceability * 1.5; // danceability → crosswalks, record shops
    const built = 0.4 + f.energy * 1.2; // energy → konbini, apartment stacks
    return TILES.map(t => {
        let factor = 1;
        if (t.kind === 'crown') {
            factor = urban;
        } else if (t.kind === 'social' || t.kind === 'circulation') {
            factor = social;
        } else if (t.kind === 'built') {
            factor = built;
        }
        return Math.max(0.01, t.baseWeight * factor);
    });
}

function deriveTimeOfDay(f: AudioFeatures): TimeOfDay {
    // High valence → dusk (golden-hour city pop vibes); otherwise night
    if (f.valence >= 0.6) {
        return 'dusk';
    }
    return 'night';
}

function deriveWeather(f: AudioFeatures): Weather {
    if (f.energy >= 0.55) {
        return 'clear';
    }
    if (f.valence < 0.4) {
        return 'rain'; // rainy city pop / vaporwave aesthetic
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

export const tokyoCityPopBiome: Biome = {
    id: 'tokyo-city-pop',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'metro-moat',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            // Tempo above 125 BPM pushes prop density up toward neon-dense city grid
            propDensity: clamp(0.08 + (features.tempo / 125) * 0.1, 0.08, 0.24)
        };
    },
    placeProps
};
