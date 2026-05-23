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
 * The Jungle Canopy biome — a tropical rainforest canopy village rising from
 * marsh water through root paths, tree platforms, canopy huts, and giant kapok
 * crowns. Afrobeats, bossa nova, Amazonian — medium energy, medium valence,
 * deep-jungle greens.
 */

type CanopyKind =
    | 'border'
    | 'transition'
    | 'ground'
    | 'nature'
    | 'built'
    | 'crown';

interface CanopyTile extends BiomeTile {
    baseWeight: number;
    kind: CanopyKind;
}

const TILES: readonly CanopyTile[] = [
    {
        id: 'marsh-water',
        cls: 0,
        height: 0.04,
        baseWeight: 0.4,
        kind: 'border'
    },
    {
        id: 'mud-root',
        cls: 1,
        height: 0.16,
        baseWeight: 1.0,
        kind: 'transition'
    },
    {
        id: 'forest-floor',
        cls: 2,
        height: 0.3,
        baseWeight: 2.1,
        kind: 'ground'
    },
    { id: 'fern-patch', cls: 2, height: 0.34, baseWeight: 1.8, kind: 'nature' },
    { id: 'root-path', cls: 2, height: 0.36, baseWeight: 1.0, kind: 'nature' },
    {
        id: 'tree-platform',
        cls: 3,
        height: 0.62,
        baseWeight: 1.2,
        kind: 'built'
    },
    { id: 'rope-bridge', cls: 3, height: 0.58, baseWeight: 0.8, kind: 'built' },
    { id: 'canopy-hut', cls: 3, height: 0.68, baseWeight: 1.0, kind: 'built' },
    { id: 'giant-kapok', cls: 4, height: 0.92, baseWeight: 0.8, kind: 'crown' },
    { id: 'mist-crown', cls: 4, height: 0.84, baseWeight: 0.6, kind: 'crown' }
];

/** Deep-jungle greens with teal water and mist-light highlights. */
const PALETTE = [
    '#0b3d2e', // 0 deep-jungle
    '#1f7a4d', // 1 leaf-shadow
    '#55a630', // 2 leaf-bright
    '#9bc53d', // 3 lime-moss
    '#6b4f2a', // 4 wood
    '#2f1f18', // 5 dark-root
    '#47c2b1', // 6 water-teal
    '#d8f3dc' // 7 mist-light
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    'giant-kapok': ['vine-curtain', 'bird-flock'],
    'mist-crown': ['bird-flock'],
    'tree-platform': ['vine-curtain', 'drum-circle', 'hammock'],
    'forest-floor': ['drum-circle'],
    'fern-patch': ['lantern-orchid'],
    'root-path': ['lantern-orchid'],
    'canopy-hut': ['hammock'],
    'rope-bridge': ['rope-knot']
};

function deriveWeights(f: AudioFeatures): number[] {
    const canopy = 0.5 + f.energy * 1.6; // energy → giant-kapok, rope-bridge, tree-platform
    const floor = 0.5 + f.danceability * 1.4; // danceability → forest-floor clearings
    const verdant = 0.4 + f.valence * 1.0; // valence → fern-patch, root-path lushness
    return TILES.map(t => {
        let factor = 1;
        if (
            t.kind === 'crown' ||
            t.id === 'rope-bridge' ||
            t.id === 'tree-platform'
        ) {
            factor = canopy;
        } else if (t.id === 'forest-floor') {
            factor = floor;
        } else if (t.kind === 'nature') {
            factor = verdant;
        }
        return Math.max(0.01, t.baseWeight * factor);
    });
}

function deriveTimeOfDay(f: AudioFeatures): TimeOfDay {
    if (f.valence >= 0.65) {
        return 'dawn'; // bright tropical morning
    }
    if (f.valence >= 0.4) {
        return 'day'; // full humid daylight
    }
    return 'dusk'; // shadow-green evening
}

function deriveWeather(f: AudioFeatures): Weather {
    if (f.valence < 0.35) {
        return 'rain'; // rainforest rain
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

export const jungleCanopyBiome: Biome = {
    id: 'jungle-canopy',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'marsh-water', // cls-0 tile
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            // lush and dense — 0.12..0.26
            propDensity: clamp(0.12 + (features.tempo / 120) * 0.09, 0.12, 0.26)
        };
    },
    placeProps
};
