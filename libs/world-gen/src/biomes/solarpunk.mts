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
 * The solarpunk biome — a green-tech utopia of bioswales, vertical gardens,
 * solar canopies, and bright commons. Leaf-bright greens, aqua-tech blues, and
 * warm cream/white produce a hopeful, organic, sunlit world that the WFC engine
 * bands from water bioswale (border) up through meadow paths and garden beds to
 * living walls and greenhouse crowns.
 */

type SolarpunkKind =
    | 'border'
    | 'transition'
    | 'ground'
    | 'nature'
    | 'social'
    | 'built'
    | 'crown';

interface SolarpunkTile extends BiomeTile {
    baseWeight: number;
    kind: SolarpunkKind;
}

const TILES: readonly SolarpunkTile[] = [
    {
        id: 'bioswale-water',
        cls: 0,
        height: 0.05,
        baseWeight: 0.35,
        kind: 'border'
    },
    {
        id: 'reed-bank',
        cls: 1,
        height: 0.16,
        baseWeight: 0.9,
        kind: 'transition'
    },
    { id: 'meadow-path', cls: 2, height: 0.3, baseWeight: 1.8, kind: 'ground' },
    { id: 'garden-bed', cls: 2, height: 0.34, baseWeight: 2.2, kind: 'nature' },
    {
        id: 'commons-plaza',
        cls: 2,
        height: 0.38,
        baseWeight: 1.4,
        kind: 'social'
    },
    { id: 'solar-canopy', cls: 3, height: 0.6, baseWeight: 1.2, kind: 'built' },
    { id: 'living-wall', cls: 3, height: 0.66, baseWeight: 1.3, kind: 'built' },
    { id: 'workshop', cls: 3, height: 0.62, baseWeight: 0.9, kind: 'built' },
    {
        id: 'greenhouse-dome',
        cls: 4,
        height: 0.84,
        baseWeight: 0.8,
        kind: 'crown'
    },
    { id: 'wind-tree', cls: 4, height: 0.92, baseWeight: 0.45, kind: 'crown' }
];

/** Leaf-bright greens, aqua-tech blues, warm cream/white — hopeful and sunlit. */
const PALETTE = [
    '#f7f1d2', // 0 sun-cream
    '#7ac943', // 1 leaf-bright
    '#2f9e68', // 2 deep-green
    '#41c7c7', // 3 aqua-tech
    '#f6c85f', // 4 solar-gold
    '#9fd7a5', // 5 garden-soft
    '#6b6f3a', // 6 olive-structure
    '#ffffff' // 7 clean-white
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    'solar-canopy': ['solar-panel'],
    'greenhouse-dome': ['solar-panel'],
    'garden-bed': ['planter-box'],
    'commons-plaza': ['planter-box', 'bike-rack', 'community-table'],
    'meadow-path': ['bike-rack'],
    'living-wall': ['rain-chain'],
    workshop: ['rain-chain'],
    'wind-tree': ['birdhouse']
};

function deriveWeights(f: AudioFeatures): number[] {
    const garden = 0.5 + f.valence * 1.8; // high valence → more garden/plaza tiles
    const built = 0.5 + f.energy * 1.6; // high energy → more solar-canopy/built tiles
    const commons = 0.5 + f.danceability * 1.5; // high danceability → more commons-plaza
    return TILES.map(t => {
        let factor = 1;
        if (t.kind === 'nature') {
            factor = garden;
        } else if (t.kind === 'social') {
            factor = commons;
        } else if (t.kind === 'built' || t.kind === 'crown') {
            factor = built;
        }
        return Math.max(0.01, t.baseWeight * factor);
    });
}

function deriveTimeOfDay(f: AudioFeatures): TimeOfDay {
    if (f.valence >= 0.65) {
        return f.valence >= 0.8 ? 'dawn' : 'day';
    }
    return f.valence >= 0.4 ? 'day' : 'dusk';
}

function deriveWeather(f: AudioFeatures): Weather {
    // Rare growing rain only when high energy meets low valence; otherwise always clear/sunny.
    if (f.energy > 0.65 && f.valence < 0.4) {
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

export const solarpunkBiome: Biome = {
    id: 'solarpunk',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'bioswale-water',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            // Higher valence → lush and alive; clamped to 0.10..0.22
            propDensity: clamp(0.1 + features.valence * 0.12, 0.1, 0.22)
        };
    },
    placeProps
};
