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
 * The bollywood-ghats biome — Indian riverside stepped ghats rising from a
 * sacred river to temple spires. Saffron, marigold, and magenta saturate every
 * surface; diya lamps, river boats, and flower markets animate the terraces.
 * High danceability packs the stone steps with festival choreography; high
 * energy raises the temple walls and shikhara crowns into the sky.
 */

type BollywoodGhatsKind =
    | 'border'
    | 'transition'
    | 'circulation'
    | 'social'
    | 'ground'
    | 'built'
    | 'crown';

interface BollywoodGhatsTile extends BiomeTile {
    baseWeight: number;
    kind: BollywoodGhatsKind;
}

const TILES: readonly BollywoodGhatsTile[] = [
    {
        id: 'sacred-river',
        cls: 0,
        height: 0.04,
        baseWeight: 0.45,
        kind: 'border'
    },
    {
        id: 'wet-ghat',
        cls: 1,
        height: 0.14,
        baseWeight: 1.0,
        kind: 'transition'
    },
    {
        id: 'stone-steps',
        cls: 2,
        height: 0.32,
        baseWeight: 2.2,
        kind: 'circulation'
    },
    {
        id: 'flower-market',
        cls: 2,
        height: 0.36,
        baseWeight: 1.4,
        kind: 'social'
    },
    {
        id: 'courtyard',
        cls: 2,
        height: 0.34,
        baseWeight: 1.3,
        kind: 'ground'
    },
    {
        id: 'boat-landing',
        cls: 3,
        height: 0.5,
        baseWeight: 0.8,
        kind: 'built'
    },
    {
        id: 'market-stall',
        cls: 3,
        height: 0.56,
        baseWeight: 1.1,
        kind: 'built'
    },
    {
        id: 'temple-wall',
        cls: 3,
        height: 0.68,
        baseWeight: 1.3,
        kind: 'built'
    },
    {
        id: 'shikhara',
        cls: 4,
        height: 0.88,
        baseWeight: 0.8,
        kind: 'crown'
    },
    {
        id: 'lamp-tower',
        cls: 4,
        height: 0.82,
        baseWeight: 0.6,
        kind: 'crown'
    }
];

/** Saffron/marigold/magenta festival palette with river-blue accent. */
const PALETTE = [
    '#f15a24', // 0 saffron
    '#ffcc33', // 1 marigold
    '#d7267d', // 2 magenta
    '#3b82f6', // 3 river-blue
    '#8b4513', // 4 wood-brown
    '#f7e7b2', // 5 sandstone
    '#6a3d9a', // 6 royal-purple
    '#1f6f50' //  7 leaf-green
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    'sacred-river': ['river-boat'],
    'stone-steps': ['diya-lamp'],
    'flower-market': ['marigold-garland', 'tabla-player'],
    courtyard: ['fabric-canopy', 'tabla-player'],
    'boat-landing': ['river-boat'],
    'market-stall': ['fabric-canopy'],
    'temple-wall': ['marigold-garland'],
    shikhara: ['prayer-flag'],
    'lamp-tower': ['diya-lamp', 'prayer-flag']
};

function deriveWeights(f: AudioFeatures): number[] {
    const temple = 0.5 + f.energy * 1.8; // high energy → temple-wall/shikhara
    const ghat = 0.5 + f.danceability * 1.6; // danceability → stone-steps/courtyard
    const market = 0.5 + f.valence * 1.4; // high valence → flower-market
    return TILES.map(t => {
        let factor = 1;
        if (t.kind === 'built' || t.kind === 'crown') {
            factor = temple;
        } else if (t.kind === 'circulation' || t.kind === 'ground') {
            factor = ghat;
        } else if (t.kind === 'social') {
            factor = market;
        }
        return Math.max(0.01, t.baseWeight * factor);
    });
}

function deriveTimeOfDay(f: AudioFeatures): TimeOfDay {
    if (f.valence >= 0.55) {
        return 'dawn'; // golden-hour puja light
    }
    if (f.energy < 0.4) {
        return 'dusk'; // lamp-lit evening aarti
    }
    return 'night';
}

function deriveWeather(f: AudioFeatures): Weather {
    if (f.energy > 0.55 && f.valence >= 0.4 && f.valence < 0.65) {
        return 'fog'; // monsoon mist on the ghats
    }
    if (f.energy < 0.35) {
        return 'rain'; // low energy → steady rain on river
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

export const bollywoodGhatsBiome: Biome = {
    id: 'bollywood-ghats',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'sacred-river',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            // High danceability = dense festive decoration (0.12..0.28)
            propDensity: clamp(0.12 + features.danceability * 0.16, 0.12, 0.28)
        };
    },
    placeProps
};
