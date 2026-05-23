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
 * The tobacco-plantation biome — Cuban countryside of red-earth fields,
 * limestone mogotes, curing barns, and bohío huts. Son cubano, rumba, guajira
 * — low-medium energy, medium valence, earthy warm palette.
 */

type TobaccoKind =
    | 'border'
    | 'transition'
    | 'ground'
    | 'circulation'
    | 'hillside'
    | 'built'
    | 'crown';

interface TobaccoTile extends BiomeTile {
    baseWeight: number;
    kind: TobaccoKind;
}

const TILES: readonly TobaccoTile[] = [
    { id: 'stream', cls: 0, height: 0.05, baseWeight: 0.4, kind: 'border' },
    { id: 'bank', cls: 1, height: 0.18, baseWeight: 0.9, kind: 'transition' },
    { id: 'red-earth', cls: 2, height: 0.3, baseWeight: 2.2, kind: 'ground' },
    { id: 'field', cls: 2, height: 0.34, baseWeight: 2.6, kind: 'ground' },
    { id: 'path', cls: 2, height: 0.32, baseWeight: 1.0, kind: 'circulation' },
    {
        id: 'mogote-base',
        cls: 3,
        height: 0.5,
        baseWeight: 1.0,
        kind: 'hillside'
    },
    { id: 'barn-floor', cls: 3, height: 0.45, baseWeight: 1.2, kind: 'built' },
    { id: 'bohio', cls: 4, height: 0.65, baseWeight: 1.0, kind: 'built' },
    { id: 'curing-barn', cls: 4, height: 0.78, baseWeight: 0.9, kind: 'built' },
    { id: 'mogote', cls: 4, height: 0.95, baseWeight: 1.4, kind: 'crown' }
];

/** Earthy warm palette: red earth, tobacco greens, limestone, wood, sky. */
const PALETTE = [
    '#8b5a3c', // 0 red-earth
    '#2c5f3f', // 1 deep-tobacco
    '#a0c060', // 2 young-tobacco
    '#6b8e23', // 3 olive
    '#d4b78f', // 4 limestone
    '#4a3826', // 5 wood-brown
    '#4a9bd1', // 6 stream-blue
    '#fce8c8' //  7 thatch-cream
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    field: ['tobacco-plant'],
    path: ['ox-cart', 'rooster'],
    'barn-floor': ['drying-rack', 'lantern'],
    'mogote-base': ['royal-palm'],
    'red-earth': ['royal-palm', 'rooster'],
    bank: ['water-trough'],
    bohio: ['lantern', 'rocking-chair']
};

function deriveWeights(f: AudioFeatures): number[] {
    const pastoral = 0.6 + (1 - f.energy) * 1.4; // low energy → open fields
    const built = 0.5 + f.energy * 1.5; // higher energy → barns/bohíos
    const social = 0.5 + f.danceability * 1.4; // danceability → paths
    return TILES.map(t => {
        let factor = 1;
        if (t.kind === 'ground') {
            factor = pastoral;
        } else if (t.kind === 'built') {
            factor = built;
        } else if (t.kind === 'circulation') {
            factor = social;
        }
        return Math.max(0.01, t.baseWeight * factor);
    });
}

function deriveTimeOfDay(f: AudioFeatures): 'dawn' | 'day' | 'dusk' {
    if (f.valence >= 0.65) return 'dawn';
    if (f.valence >= 0.4) return 'day';
    return 'dusk';
}

function deriveWeather(f: AudioFeatures): 'clear' | 'fog' {
    if (f.energy < 0.35 && f.valence < 0.4) return 'fog';
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

export const tobaccoPlantationBiome: Biome = {
    id: 'tobacco-plantation',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'stream',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            propDensity: clamp(0.05 + (features.tempo / 120) * 0.075, 0.05, 0.2)
        };
    },
    placeProps
};
