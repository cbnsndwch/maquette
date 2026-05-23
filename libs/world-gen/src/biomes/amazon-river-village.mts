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
 * The Amazon River Village biome — stilt houses, canoe channels, flooded forest,
 * market decks, and riverbank terraces under humid light. Cumbia, chicha, and
 * indigenous Amazonian music create warm social islands surrounded by slow brown water.
 */

type AmazonKind =
    | 'border'
    | 'ground'
    | 'circulation'
    | 'nature'
    | 'built'
    | 'social'
    | 'crown';

interface AmazonTile extends BiomeTile {
    baseWeight: number;
    kind: AmazonKind;
}

const TILES: readonly AmazonTile[] = [
    {
        id: 'brown-river',
        cls: 0,
        height: 0.04,
        baseWeight: 0.5,
        kind: 'border'
    },
    { id: 'mud-bank', cls: 1, height: 0.14, baseWeight: 1.0, kind: 'ground' },
    { id: 'floodplain', cls: 2, height: 0.28, baseWeight: 1.8, kind: 'ground' },
    {
        id: 'canoe-channel',
        cls: 2,
        height: 0.22,
        baseWeight: 1.0,
        kind: 'circulation'
    },
    {
        id: 'garden-bank',
        cls: 2,
        height: 0.34,
        baseWeight: 1.3,
        kind: 'nature'
    },
    { id: 'stilt-house', cls: 3, height: 0.6, baseWeight: 1.4, kind: 'built' },
    {
        id: 'market-deck',
        cls: 3,
        height: 0.54,
        baseWeight: 1.0,
        kind: 'social'
    },
    { id: 'watch-pier', cls: 3, height: 0.58, baseWeight: 0.8, kind: 'built' },
    { id: 'ceiba-crown', cls: 4, height: 0.88, baseWeight: 0.8, kind: 'crown' },
    { id: 'radio-tower', cls: 4, height: 0.92, baseWeight: 0.35, kind: 'crown' }
];

/** River-brown and jungle-green; positions are this biome's own semantics. */
const PALETTE = [
    '#6b4a2f', // 0 river-brown
    '#9b6b3d', // 1 mud-gold
    '#1f6f4a', // 2 jungle-green
    '#63a35c', // 3 garden-green
    '#c58b4b', // 4 wood
    '#e7c88f', // 5 thatch
    '#2e8fa3', // 6 water-blue
    '#f2e6c9' // 7 sun-cream
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    'brown-river': ['canoe'],
    'canoe-channel': ['canoe'],
    'market-deck': ['fish-basket', 'hanging-lantern'],
    'watch-pier': ['fish-basket'],
    'stilt-house': ['hanging-lantern'],
    'garden-bank': ['plantain-patch'],
    'radio-tower': ['radio-dish'],
    'ceiba-crown': ['river-bird'],
    'mud-bank': ['river-bird']
};

function deriveWeights(f: AudioFeatures): number[] {
    const social = 0.5 + f.danceability * 1.6; // danceability → market-deck / stilt-house
    const built = 0.5 + f.energy * 1.4; // energy → market-deck / radio-tower
    const nature = 0.6 + (1 - f.energy) * 0.9; // low energy → garden-bank / floodplain
    return TILES.map(t => {
        let factor = 1;
        if (t.kind === 'social') {
            factor = social * built;
        } else if (t.kind === 'built' || t.kind === 'crown') {
            factor = built;
        } else if (t.kind === 'nature' || t.kind === 'ground') {
            factor = nature;
        }
        return Math.max(0.01, t.baseWeight * factor);
    });
}

function deriveTimeOfDay(f: AudioFeatures): 'dawn' | 'day' | 'dusk' {
    if (f.valence >= 0.65) return 'dawn';
    if (f.valence >= 0.4) return 'day';
    return 'dusk';
}

function deriveWeather(f: AudioFeatures): 'clear' | 'rain' {
    return f.valence < 0.4 ? 'rain' : 'clear';
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

export const amazonRiverVillageBiome: Biome = {
    id: 'amazon-river-village',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'brown-river',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            propDensity: clamp(0.08 + (features.tempo / 120) * 0.09, 0.06, 0.22)
        };
    },
    placeProps
};
