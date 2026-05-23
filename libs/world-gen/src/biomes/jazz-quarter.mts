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
 * The jazz-quarter biome — New Orleans French Quarter of cobblestone streets,
 * wrought-iron balconies, jazz clubs, gas lamps, and moonlit canals.
 * Jazz/soul/blues — medium energy, medium-high valence, night-plum/brass/
 * lamp-gold palette. Jazz lives at night.
 */

type JazzKind =
    | 'border'
    | 'transition'
    | 'ground'
    | 'circulation'
    | 'social'
    | 'built'
    | 'crown';

interface JazzTile extends BiomeTile {
    baseWeight: number;
    kind: JazzKind;
}

const TILES: readonly JazzTile[] = [
    {
        id: 'canal-shadow',
        cls: 0,
        height: 0.05,
        baseWeight: 0.35,
        kind: 'border'
    },
    {
        id: 'wet-curb',
        cls: 1,
        height: 0.15,
        baseWeight: 0.9,
        kind: 'transition'
    },
    {
        id: 'brick-street',
        cls: 2,
        height: 0.3,
        baseWeight: 2.4,
        kind: 'ground'
    },
    {
        id: 'alley',
        cls: 2,
        height: 0.28,
        baseWeight: 1.2,
        kind: 'circulation'
    },
    {
        id: 'courtyard',
        cls: 2,
        height: 0.34,
        baseWeight: 1.5,
        kind: 'social'
    },
    {
        id: 'jazz-club',
        cls: 3,
        height: 0.62,
        baseWeight: 1.5,
        kind: 'built'
    },
    {
        id: 'iron-balcony',
        cls: 3,
        height: 0.68,
        baseWeight: 1.0,
        kind: 'built'
    },
    {
        id: 'corner-cafe',
        cls: 3,
        height: 0.58,
        baseWeight: 1.0,
        kind: 'built'
    },
    {
        id: 'hotel-roof',
        cls: 4,
        height: 0.82,
        baseWeight: 0.8,
        kind: 'crown'
    },
    {
        id: 'clock-tower',
        cls: 4,
        height: 0.94,
        baseWeight: 0.35,
        kind: 'crown'
    }
];

/** Night-plum / brass / lamp-gold palette. */
const PALETTE = [
    '#1b1720', // 0 night-plum
    '#6b2e2e', // 1 brick-red
    '#c29a5b', // 2 brass
    '#f2d27a', // 3 lamp-gold
    '#2f4858', // 4 blue-shadow
    '#0c0f14', // 5 canal-black
    '#8b7a6b', // 6 wet-stone
    '#ede1c5' //  7 cream-light
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    'brick-street': ['streetlamp'],
    courtyard: ['streetlamp', 'sax-player', 'cafe-table'],
    alley: ['streetlamp', 'poster-wall'],
    'jazz-club': ['club-sign', 'poster-wall'],
    'corner-cafe': ['sax-player', 'cafe-table'],
    'iron-balcony': ['balcony-rail']
};

function deriveWeights(f: AudioFeatures): number[] {
    const nightlife = 0.5 + f.energy * 1.5; // energy → clubs/cafes
    const communal = 0.5 + f.danceability * 1.4; // danceability → courtyard/street
    const gritty = 0.6 + (1 - f.valence) * 1.1; // low valence → alleys
    return TILES.map(t => {
        let factor = 1;
        if (t.kind === 'built') {
            factor = nightlife;
        } else if (t.kind === 'social') {
            factor = communal;
        } else if (t.kind === 'circulation') {
            factor = gritty;
        }
        return Math.max(0.01, t.baseWeight * factor);
    });
}

function deriveTimeOfDay(f: AudioFeatures): 'dusk' | 'night' {
    return f.valence >= 0.65 ? 'dusk' : 'night';
}

function deriveWeather(f: AudioFeatures): 'clear' | 'fog' {
    if (f.energy < 0.35) return 'fog';
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

export const jazzQuarterBiome: Biome = {
    id: 'jazz-quarter',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'canal-shadow',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            propDensity: clamp(0.1 + (features.tempo / 120) * 0.08, 0.07, 0.25)
        };
    },
    placeProps
};
