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
 * The Polynesian Atoll biome — a ring-shaped lagoon world with coral sand, pandanus
 * groves, fale huts, lava rocks, and canoe docks. Reggae, Hawaiian slack-key, and
 * Pacific island music keep the architecture light, breezy, and sunset-warm.
 */

type AtollKind =
    | 'border'
    | 'transition'
    | 'ground'
    | 'nature'
    | 'circulation'
    | 'built'
    | 'hillside'
    | 'crown';

interface AtollTile extends BiomeTile {
    baseWeight: number;
    kind: AtollKind;
}

const TILES: readonly AtollTile[] = [
    {
        id: 'lagoon-water',
        cls: 0,
        height: 0.04,
        baseWeight: 0.5,
        kind: 'border'
    },
    {
        id: 'reef-ring',
        cls: 1,
        height: 0.14,
        baseWeight: 1.0,
        kind: 'transition'
    },
    { id: 'coral-sand', cls: 2, height: 0.26, baseWeight: 2.3, kind: 'ground' },
    {
        id: 'pandanus-grove',
        cls: 2,
        height: 0.34,
        baseWeight: 1.5,
        kind: 'nature'
    },
    {
        id: 'shell-path',
        cls: 2,
        height: 0.3,
        baseWeight: 1.0,
        kind: 'circulation'
    },
    { id: 'fale-hut', cls: 3, height: 0.56, baseWeight: 1.2, kind: 'built' },
    { id: 'canoe-dock', cls: 3, height: 0.48, baseWeight: 0.9, kind: 'built' },
    {
        id: 'lava-rock',
        cls: 3,
        height: 0.62,
        baseWeight: 0.9,
        kind: 'hillside'
    },
    { id: 'totem-mast', cls: 4, height: 0.82, baseWeight: 0.5, kind: 'crown' },
    {
        id: 'volcanic-crown',
        cls: 4,
        height: 0.88,
        baseWeight: 0.6,
        kind: 'crown'
    }
];

/** Lagoon-blue, reef-mint, and lava-black; positions are this biome's own semantics. */
const PALETTE = [
    '#00a8c8', // 0 lagoon-blue
    '#7ee8d4', // 1 reef-mint
    '#f6df9f', // 2 coral-sand
    '#2f8f5b', // 3 pandanus-green
    '#9b5d2e', // 4 thatch-wood
    '#333333', // 5 lava-black
    '#f2f0e6', // 6 shell-white
    '#ffb84d' // 7 sunset-orange
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    'lagoon-water': ['outrigger-canoe'],
    'canoe-dock': ['outrigger-canoe', 'surfboard'],
    'fale-hut': ['ukulele-seat', 'flower-lei'],
    'shell-path': ['ukulele-seat', 'tiki-torch'],
    'pandanus-grove': ['flower-lei'],
    'totem-mast': ['tiki-torch'],
    'coral-sand': ['crab', 'surfboard'],
    'reef-ring': ['crab']
};

function deriveWeights(f: AudioFeatures): number[] {
    const active = 0.5 + f.energy * 1.4; // energy → canoe-dock / volcanic-crown
    const communal = 0.5 + f.danceability * 1.3; // danceability → shell-path / fale-hut
    const lush = 0.6 + (1 - f.energy) * 0.8; // low energy → coral-sand / pandanus-grove
    return TILES.map(t => {
        let factor = 1;
        if (t.kind === 'crown' || t.id === 'canoe-dock') {
            factor = active;
        } else if (t.kind === 'circulation' || t.kind === 'built') {
            factor = communal;
        } else if (t.kind === 'ground' || t.kind === 'nature') {
            factor = lush;
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
    return f.energy < 0.35 ? 'rain' : 'clear';
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

export const polynesianAtollBiome: Biome = {
    id: 'polynesian-atoll',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'lagoon-water',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            propDensity: clamp(0.07 + (features.tempo / 120) * 0.09, 0.05, 0.22)
        };
    },
    placeProps
};
