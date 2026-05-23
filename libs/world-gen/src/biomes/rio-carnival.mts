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
 * The Rio Carnival biome — an explosive parade avenue rising from Guanabara Bay
 * through confetti plazas, samba stands, and float towers. High valence, high
 * energy, bay-blue + carnival-pink + violet palette. Samba, forró, baile funk.
 */

type RioKind =
    | 'border'
    | 'transition'
    | 'ground'
    | 'nature'
    | 'built'
    | 'crown';

interface RioTile extends BiomeTile {
    baseWeight: number;
    kind: RioKind;
}

const TILES: readonly RioTile[] = [
    { id: 'bay-water', cls: 0, height: 0.05, baseWeight: 0.35, kind: 'border' },
    {
        id: 'beach-edge',
        cls: 1,
        height: 0.15,
        baseWeight: 0.9,
        kind: 'transition'
    },
    {
        id: 'parade-street',
        cls: 2,
        height: 0.3,
        baseWeight: 2.2,
        kind: 'ground'
    },
    {
        id: 'confetti-plaza',
        cls: 2,
        height: 0.34,
        baseWeight: 1.7,
        kind: 'ground'
    },
    {
        id: 'tropical-garden',
        cls: 2,
        height: 0.36,
        baseWeight: 1.1,
        kind: 'nature'
    },
    { id: 'samba-stand', cls: 3, height: 0.58, baseWeight: 1.2, kind: 'built' },
    { id: 'float-base', cls: 3, height: 0.66, baseWeight: 1.4, kind: 'built' },
    {
        id: 'hillside-house',
        cls: 3,
        height: 0.62,
        baseWeight: 1.0,
        kind: 'built'
    },
    {
        id: 'feather-tower',
        cls: 4,
        height: 0.9,
        baseWeight: 0.7,
        kind: 'crown'
    },
    { id: 'sun-statue', cls: 4, height: 0.96, baseWeight: 0.35, kind: 'crown' }
];

/** Bay-blue + carnival-pink + violet palette — hot saturated light. */
const PALETTE = [
    '#00a6d6', // 0 bay-blue
    '#ffd23f', // 1 sun-yellow
    '#ff3366', // 2 carnival-pink
    '#00b050', // 3 tropical-green
    '#7b2cff', // 4 violet
    '#f8f0d8', // 5 sand-cream
    '#e87522', // 6 orange
    '#1b1b2f' // 7 night-shadow
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    'confetti-plaza': ['confetti-burst', 'samba-drum'],
    'parade-street': ['confetti-burst', 'street-vendor'],
    'samba-stand': ['samba-drum', 'flag-string'],
    'float-base': ['feather-arch'],
    'feather-tower': ['feather-arch'],
    'tropical-garden': ['tropical-flower'],
    'hillside-house': ['flag-string'],
    'beach-edge': ['street-vendor']
};

function deriveWeights(f: AudioFeatures): number[] {
    const parade = 0.5 + f.danceability * 1.8; // danceability → parade-street, samba-stand
    const crown = 0.5 + f.energy * 1.7; // energy → float-base, feather-tower
    const nature = 0.4 + f.valence * 0.8; // valence → tropical-garden
    return TILES.map(t => {
        let factor = 1;
        if (t.kind === 'crown') {
            factor = crown;
        } else if (t.id === 'parade-street' || t.id === 'samba-stand') {
            factor = parade;
        } else if (t.kind === 'nature') {
            factor = nature;
        }
        return Math.max(0.01, t.baseWeight * factor);
    });
}

function deriveTimeOfDay(f: AudioFeatures): TimeOfDay {
    if (f.valence >= 0.65) {
        return 'dusk'; // golden carnival hour
    }
    return 'night'; // street party
}

function deriveWeather(f: AudioFeatures): Weather {
    if (f.energy < 0.25) {
        return 'rain'; // very low energy → humid downpour
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

export const rioCarnivalBiome: Biome = {
    id: 'rio-carnival',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'bay-water',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            // carnival is dense and festive — 0.14..0.30
            propDensity: clamp(0.14 + (features.tempo / 120) * 0.1, 0.14, 0.3)
        };
    },
    placeProps
};
