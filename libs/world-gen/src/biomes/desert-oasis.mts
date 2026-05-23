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
 * The desert-oasis biome — Sahara caravan geometry, oasis blues, and mudbrick
 * silhouettes. Arabic maqam, Tuareg guitar, gnawa, and Rai. Medium energy,
 * medium valence, gold-sand + oasis-blue palette. Gnawa deepens the trance-like
 * market court; Tuareg guitar stretches the dunes.
 */

type DesertKind =
    | 'border'
    | 'transition'
    | 'ground'
    | 'nature'
    | 'circulation'
    | 'built'
    | 'social'
    | 'crown';

interface DesertTile extends BiomeTile {
    baseWeight: number;
    kind: DesertKind;
}

const TILES: readonly DesertTile[] = [
    { id: 'salt-pan', cls: 0, height: 0.03, baseWeight: 0.35, kind: 'border' },
    {
        id: 'dune-rim',
        cls: 1,
        height: 0.18,
        baseWeight: 1.1,
        kind: 'transition'
    },
    { id: 'sand-flat', cls: 2, height: 0.3, baseWeight: 2.3, kind: 'ground' },
    { id: 'palm-oasis', cls: 2, height: 0.36, baseWeight: 1.4, kind: 'nature' },
    {
        id: 'caravan-path',
        cls: 2,
        height: 0.32,
        baseWeight: 1.0,
        kind: 'circulation'
    },
    { id: 'tent-camp', cls: 3, height: 0.52, baseWeight: 1.1, kind: 'built' },
    {
        id: 'mudbrick-wall',
        cls: 3,
        height: 0.64,
        baseWeight: 1.2,
        kind: 'built'
    },
    {
        id: 'market-court',
        cls: 3,
        height: 0.54,
        baseWeight: 0.9,
        kind: 'social'
    },
    { id: 'minaret', cls: 4, height: 0.88, baseWeight: 0.6, kind: 'crown' },
    { id: 'dune-crest', cls: 4, height: 0.78, baseWeight: 1.0, kind: 'crown' }
];

/** Gold-sand base with oasis-blue, mudbrick, and palm-green. */
const PALETTE = [
    '#f2c879', // 0 gold-sand
    '#d99a45', // 1 amber-dune
    '#8a4f2a', // 2 mudbrick
    '#1f9fb4', // 3 oasis-blue
    '#2f6f4e', // 4 palm-green
    '#f7e4b1', // 5 sun-cream
    '#3a2a2a', // 6 shadow-brown
    '#ffffff' // 7 salt-white
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    'palm-oasis': ['date-palm', 'water-jar'],
    'caravan-path': ['camel'],
    'sand-flat': ['camel'],
    'tent-camp': ['woven-rug', 'lantern'],
    'mudbrick-wall': ['lantern'],
    'market-court': ['water-jar', 'woven-rug'],
    minaret: ['wind-banner'],
    'dune-crest': ['wind-banner']
};

function deriveWeights(f: AudioFeatures): number[] {
    const windswept = 0.5 + f.energy * 1.6; // energy → dune-crest, caravan-path
    const gathered = 0.5 + f.danceability * 1.5; // danceability → market-court, tent-camp
    const built = 0.4 + f.energy * 1.2; // energy → mudbrick-wall, minaret
    return TILES.map(t => {
        let factor = 1;
        if (t.kind === 'crown' || t.kind === 'circulation') {
            factor = windswept;
        } else if (t.kind === 'social') {
            factor = gathered;
        } else if (t.kind === 'built') {
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
    return 'dusk';
}

function deriveWeather(f: AudioFeatures): Weather {
    if (f.energy > 0.6 && f.valence < 0.4) {
        return 'fog'; // desert haze / sandstorm
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

export const desertOasisBiome: Biome = {
    id: 'desert-oasis',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'salt-pan',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            // Moderate (0.08..0.20) — sparse at low energy, denser near oasis tiles
            propDensity: clamp(0.08 + (features.tempo / 120) * 0.09, 0.08, 0.2)
        };
    },
    placeProps
};
