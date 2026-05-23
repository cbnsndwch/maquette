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
 * The West African Savanna biome — golden grassland with baobabs, kora circles,
 * clay compounds, market shade, and sunset ridges. Afrobeats, highlife, kora, and
 * mbalax create open rhythmic gathering courts across warm red earth.
 */

type SavannaKind =
    | 'border'
    | 'transition'
    | 'ground'
    | 'circulation'
    | 'social'
    | 'nature'
    | 'built'
    | 'crown';

interface SavannaTile extends BiomeTile {
    baseWeight: number;
    kind: SavannaKind;
}

const TILES: readonly SavannaTile[] = [
    {
        id: 'dry-riverbed',
        cls: 0,
        height: 0.04,
        baseWeight: 0.35,
        kind: 'border'
    },
    {
        id: 'dust-edge',
        cls: 1,
        height: 0.15,
        baseWeight: 1.0,
        kind: 'transition'
    },
    { id: 'gold-grass', cls: 2, height: 0.3, baseWeight: 2.4, kind: 'ground' },
    {
        id: 'red-path',
        cls: 2,
        height: 0.32,
        baseWeight: 1.1,
        kind: 'circulation'
    },
    {
        id: 'shade-court',
        cls: 2,
        height: 0.36,
        baseWeight: 1.3,
        kind: 'social'
    },
    {
        id: 'baobab-grove',
        cls: 3,
        height: 0.62,
        baseWeight: 1.2,
        kind: 'nature'
    },
    {
        id: 'clay-compound',
        cls: 3,
        height: 0.58,
        baseWeight: 1.1,
        kind: 'built'
    },
    {
        id: 'market-shelter',
        cls: 3,
        height: 0.54,
        baseWeight: 0.9,
        kind: 'built'
    },
    { id: 'drum-tower', cls: 4, height: 0.82, baseWeight: 0.6, kind: 'crown' },
    { id: 'sunset-ridge', cls: 4, height: 0.88, baseWeight: 0.8, kind: 'crown' }
];

/** Gold-grass, red-earth, and sunset-gold; positions are this biome's own semantics. */
const PALETTE = [
    '#d9a441', // 0 gold-grass
    '#b85c2e', // 1 red-earth
    '#7a4a24', // 2 baobab-bark
    '#5e8c31', // 3 leaf-green
    '#f2d28b', // 4 thatch
    '#8b2f23', // 5 clay-red
    '#2d2a1f', // 6 deep-shadow
    '#ffcc5c' // 7 sunset-gold
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    'baobab-grove': ['baobab-tree'],
    'shade-court': ['kora-player', 'djembe'],
    'market-shelter': ['kora-player', 'woven-basket'],
    'clay-compound': ['woven-basket'],
    'gold-grass': ['goat'],
    'red-path': ['goat'],
    'drum-tower': ['djembe', 'sun-banner'],
    'sunset-ridge': ['sun-banner']
};

function deriveWeights(f: AudioFeatures): number[] {
    const active = 0.5 + f.energy * 1.5; // energy → drum-tower / market-shelter / red-path
    const communal = 0.5 + f.danceability * 1.4; // danceability → shade-court / red-path
    const open = 0.6 + (1 - f.energy) * 0.7; // low energy → gold-grass / dust-edge
    return TILES.map(t => {
        let factor = 1;
        if (t.kind === 'crown' || t.id === 'market-shelter') {
            factor = active;
        } else if (t.kind === 'social' || t.kind === 'circulation') {
            factor = communal;
        } else if (t.kind === 'ground') {
            factor = open;
        }
        return Math.max(0.01, t.baseWeight * factor);
    });
}

function deriveTimeOfDay(f: AudioFeatures): 'day' | 'dusk' | 'night' {
    if (f.valence >= 0.65) return 'day';
    if (f.valence >= 0.4) return 'dusk';
    return 'night';
}

function deriveWeather(f: AudioFeatures): 'clear' | 'fog' {
    if (f.energy < 0.4 && f.valence < 0.4) return 'fog'; // harmattan dust
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

export const westAfricanSavannaBiome: Biome = {
    id: 'west-african-savanna',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'dry-riverbed',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            propDensity: clamp(0.08 + (features.tempo / 120) * 0.1, 0.06, 0.24)
        };
    },
    placeProps
};
