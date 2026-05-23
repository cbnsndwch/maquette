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
 * The Arctic Base biome — a remote research station across frozen ocean,
 * snowfields, crevasse blue, hab modules, antenna masts, and radome crowns.
 * IDM, drone, dark ambient — low energy, low-medium valence, snow-white +
 * warning-orange + steel-blue palette.
 */

type ArcticKind =
    | 'border'
    | 'transition'
    | 'ground'
    | 'hazard'
    | 'built'
    | 'crown';

interface ArcticTile extends BiomeTile {
    baseWeight: number;
    kind: ArcticKind;
}

const TILES: readonly ArcticTile[] = [
    {
        id: 'black-sea-ice',
        cls: 0,
        height: 0.04,
        baseWeight: 0.45,
        kind: 'border'
    },
    {
        id: 'ice-shelf',
        cls: 1,
        height: 0.14,
        baseWeight: 1.1,
        kind: 'transition'
    },
    { id: 'snowfield', cls: 2, height: 0.28, baseWeight: 2.5, kind: 'ground' },
    { id: 'wind-track', cls: 2, height: 0.3, baseWeight: 1.0, kind: 'ground' },
    {
        id: 'crevasse-blue',
        cls: 2,
        height: 0.24,
        baseWeight: 0.8,
        kind: 'hazard'
    },
    { id: 'hab-module', cls: 3, height: 0.56, baseWeight: 1.1, kind: 'built' },
    { id: 'lab-block', cls: 3, height: 0.64, baseWeight: 1.2, kind: 'built' },
    {
        id: 'antenna-mast',
        cls: 3,
        height: 0.76,
        baseWeight: 0.7,
        kind: 'built'
    },
    { id: 'radome', cls: 4, height: 0.86, baseWeight: 0.7, kind: 'crown' },
    { id: 'ice-ridge', cls: 4, height: 0.8, baseWeight: 1.0, kind: 'crown' }
];

/** Snow-white + warning-orange + steel-blue — sparse survival geometry. */
const PALETTE = [
    '#eef7ff', // 0 snow-white
    '#b9d8e8', // 1 ice-blue
    '#4aa3df', // 2 crevasse-blue
    '#182033', // 3 polar-steel
    '#f8fbff', // 4 lab-white
    '#7a8699', // 5 gray-metal
    '#ff6b35', // 6 warning-orange
    '#0b0f1a' // 7 sea-black
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    snowfield: ['weather-sensor', 'snow-cat'],
    'wind-track': ['snow-cat'],
    'antenna-mast': ['weather-sensor', 'orange-beacon', 'satellite-dish'],
    'hab-module': ['orange-beacon', 'supply-crate'],
    'lab-block': ['orange-beacon', 'supply-crate'],
    radome: ['satellite-dish'],
    'crevasse-blue': ['ice-marker'],
    'ice-shelf': ['ice-marker']
};

function deriveWeights(f: AudioFeatures): number[] {
    const built = 0.4 + f.energy * 1.5; // energy → antenna-mast, ice-ridge, crevasse-blue
    const hazard = 0.3 + f.energy * 1.2; // energy → crevasse-blue exposure
    const sprawl = 0.5 + f.danceability * 0.8; // danceability → wind-track loops (restrained)
    return TILES.map(t => {
        let factor = 1;
        if (t.kind === 'crown' || t.id === 'antenna-mast') {
            factor = built;
        } else if (t.kind === 'hazard') {
            factor = hazard;
        } else if (t.id === 'wind-track') {
            factor = sprawl;
        }
        return Math.max(0.01, t.baseWeight * factor);
    });
}

function deriveTimeOfDay(f: AudioFeatures): TimeOfDay {
    if (f.valence >= 0.55) {
        return 'dawn'; // polar sunrise
    }
    return 'night'; // polar darkness
}

function deriveWeather(f: AudioFeatures): Weather {
    if (f.energy < 0.3) {
        return 'fog'; // low energy → blizzard/whiteout conditions
    }
    if (f.energy < 0.6 && f.valence < 0.4) {
        return 'fog'; // medium energy + low valence → whiteout fog
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

export const arcticBaseBiome: Biome = {
    id: 'arctic-base',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'black-sea-ice',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            // sparse, isolated structures on ice — 0.06..0.16
            propDensity: clamp(0.06 + (features.tempo / 120) * 0.06, 0.06, 0.16)
        };
    },
    placeProps
};
