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
 * The Ocean Reef biome — a shallow underwater garden of coral shelves, sand channels,
 * kelp arches, reef towers, and soft caustics. Ambient, lo-fi, chill, and surf music
 * bring caustic light, gentle drift, and living coral geometry.
 */

type ReefKind =
    | 'border'
    | 'transition'
    | 'ground'
    | 'nature'
    | 'built'
    | 'circulation'
    | 'social'
    | 'crown';

interface ReefTile extends BiomeTile {
    baseWeight: number;
    kind: ReefKind;
}

const TILES: readonly ReefTile[] = [
    { id: 'deep-water', cls: 0, height: 0.03, baseWeight: 0.5, kind: 'border' },
    {
        id: 'lagoon-edge',
        cls: 1,
        height: 0.12,
        baseWeight: 1.0,
        kind: 'transition'
    },
    {
        id: 'sand-channel',
        cls: 2,
        height: 0.22,
        baseWeight: 2.0,
        kind: 'ground'
    },
    {
        id: 'seagrass-bed',
        cls: 2,
        height: 0.28,
        baseWeight: 1.5,
        kind: 'nature'
    },
    {
        id: 'coral-garden',
        cls: 2,
        height: 0.34,
        baseWeight: 1.8,
        kind: 'nature'
    },
    { id: 'reef-shelf', cls: 3, height: 0.52, baseWeight: 1.4, kind: 'built' },
    {
        id: 'kelp-arch',
        cls: 3,
        height: 0.58,
        baseWeight: 0.8,
        kind: 'circulation'
    },
    {
        id: 'anemone-field',
        cls: 3,
        height: 0.48,
        baseWeight: 1.0,
        kind: 'social'
    },
    { id: 'coral-tower', cls: 4, height: 0.78, baseWeight: 0.9, kind: 'crown' },
    { id: 'light-spire', cls: 4, height: 0.86, baseWeight: 0.4, kind: 'crown' }
];

/** Deep-blue, coral-pink, and caustic-white; positions are this biome's own semantics. */
const PALETTE = [
    '#003f5c', // 0 deep-blue
    '#2f9fd0', // 1 reef-blue
    '#7bdff2', // 2 lagoon-cyan
    '#f5e6a8', // 3 sand
    '#ff8fab', // 4 coral-pink
    '#ffcf56', // 5 coral-gold
    '#2a9d8f', // 6 seagrass
    '#f8f9fa' // 7 caustic-white
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    'coral-garden': ['fish-school', 'soft-coral'],
    'reef-shelf': ['fish-school'],
    'lagoon-edge': ['fish-school', 'ray-shadow'],
    'seagrass-bed': ['sea-turtle'],
    'sand-channel': ['sea-turtle', 'shell-cluster'],
    'light-spire': ['bubble-column'],
    'coral-tower': ['bubble-column'],
    'deep-water': ['ray-shadow'],
    'anemone-field': ['soft-coral']
};

function deriveWeights(f: AudioFeatures): number[] {
    const vertical = 0.5 + f.energy * 1.5; // energy → coral-tower / reef-shelf
    const flowing = 0.5 + f.danceability * 1.3; // danceability → kelp-arch / anemone-field
    const openWater = 0.6 + (1 - f.energy) * 0.8; // low energy → sand-channel / seagrass-bed
    return TILES.map(t => {
        let factor = 1;
        if (t.kind === 'crown' || t.id === 'reef-shelf') {
            factor = vertical;
        } else if (t.kind === 'circulation' || t.kind === 'social') {
            factor = flowing;
        } else if (t.kind === 'ground') {
            factor = openWater;
        }
        return Math.max(0.01, t.baseWeight * factor);
    });
}

function deriveTimeOfDay(f: AudioFeatures): 'day' | 'dawn' | 'dusk' {
    if (f.valence >= 0.65) return 'day';
    if (f.valence >= 0.4) return 'dawn';
    return 'dusk';
}

function deriveWeather(_f: AudioFeatures): 'clear' {
    // Underwater — no weather variation
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

export const oceanReefBiome: Biome = {
    id: 'ocean-reef',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'deep-water',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            propDensity: clamp(0.14 + (features.tempo / 120) * 0.09, 0.14, 0.28)
        };
    },
    placeProps
};
