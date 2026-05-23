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
 * The spanish-colonial biome — colonial Cuban town with arcaded plazas, a
 * church tower, wrought-iron balconies, and cobblestones. Trova/bolero/salsa
 * — medium energy, medium-high valence, warm gold/terracotta palette.
 */

type ColonialKind =
    | 'border'
    | 'transition'
    | 'ground'
    | 'circulation'
    | 'social'
    | 'built'
    | 'crown';

interface ColonialTile extends BiomeTile {
    baseWeight: number;
    kind: ColonialKind;
}

const TILES: readonly ColonialTile[] = [
    {
        id: 'fountain-water',
        cls: 0,
        height: 0.06,
        baseWeight: 0.35,
        kind: 'border'
    },
    {
        id: 'stone-edge',
        cls: 1,
        height: 0.18,
        baseWeight: 0.9,
        kind: 'transition'
    },
    {
        id: 'cobblestone',
        cls: 2,
        height: 0.32,
        baseWeight: 2.4,
        kind: 'ground'
    },
    {
        id: 'arcade-walk',
        cls: 2,
        height: 0.36,
        baseWeight: 1.4,
        kind: 'circulation'
    },
    {
        id: 'plaza-tile',
        cls: 2,
        height: 0.34,
        baseWeight: 1.8,
        kind: 'social'
    },
    {
        id: 'stucco-wall',
        cls: 3,
        height: 0.6,
        baseWeight: 1.7,
        kind: 'built'
    },
    {
        id: 'balcony',
        cls: 3,
        height: 0.68,
        baseWeight: 0.9,
        kind: 'built'
    },
    {
        id: 'market-arch',
        cls: 3,
        height: 0.64,
        baseWeight: 1.0,
        kind: 'built'
    },
    {
        id: 'church-roof',
        cls: 4,
        height: 0.84,
        baseWeight: 0.8,
        kind: 'crown'
    },
    {
        id: 'bell-tower',
        cls: 4,
        height: 0.98,
        baseWeight: 0.4,
        kind: 'crown'
    }
];

/** Warm gold/terracotta colonial palette. */
const PALETTE = [
    '#f2d6a2', // 0 stucco-gold
    '#b85c38', // 1 clay-roof
    '#7c4a2d', // 2 wood-iron
    '#3d6f8e', // 3 fountain-blue
    '#d9c2a3', // 4 limestone
    '#2b2b32', // 5 iron-shadow
    '#f6efe3', // 6 plaza-light
    '#6a8f3f' //  7 balcony-green
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    'arcade-walk': ['wrought-lamp', 'guitarist'],
    'plaza-tile': ['wrought-lamp', 'guitarist', 'market-cart', 'bench'],
    balcony: ['balcony-plant'],
    'market-arch': ['market-cart'],
    'bell-tower': ['church-bell']
};

function deriveWeights(f: AudioFeatures): number[] {
    const streetLife = 0.5 + f.energy * 1.5; // energy → plaza/market activity
    const communal = 0.5 + f.danceability * 1.4; // danceability → plaza/arcade
    return TILES.map(t => {
        let factor = 1;
        if (t.kind === 'social') {
            factor = communal;
        } else if (t.kind === 'built' && t.id !== 'stucco-wall') {
            factor = streetLife;
        } else if (t.kind === 'circulation') {
            factor = communal;
        }
        return Math.max(0.01, t.baseWeight * factor);
    });
}

function deriveTimeOfDay(f: AudioFeatures): 'day' | 'dawn' | 'dusk' {
    if (f.valence >= 0.65) return 'day';
    if (f.valence >= 0.4) return 'dawn';
    return 'dusk';
}

function deriveWeather(f: AudioFeatures): 'clear' | 'rain' {
    if (f.energy < 0.25) return 'rain';
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

export const spanishColonialBiome: Biome = {
    id: 'spanish-colonial',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'fountain-water',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            propDensity: clamp(0.08 + (features.tempo / 120) * 0.09, 0.07, 0.24)
        };
    },
    placeProps
};
