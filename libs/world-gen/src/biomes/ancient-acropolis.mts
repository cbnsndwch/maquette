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
 * The Ancient Acropolis biome — sunlit ruins with marble terraces, olive courts,
 * broken columns, temples, and sacred hilltops. Epic orchestral and neo-classical
 * music turns ruins into monuments; ancient world music keeps it ordered and bright.
 */

type AcropolisKind =
    | 'border'
    | 'transition'
    | 'ground'
    | 'circulation'
    | 'social'
    | 'built'
    | 'crown';

interface AcropolisTile extends BiomeTile {
    baseWeight: number;
    kind: AcropolisKind;
}

const TILES: readonly AcropolisTile[] = [
    { id: 'dry-moat', cls: 0, height: 0.06, baseWeight: 0.35, kind: 'border' },
    {
        id: 'rubble-slope',
        cls: 1,
        height: 0.18,
        baseWeight: 1.0,
        kind: 'transition'
    },
    {
        id: 'marble-court',
        cls: 2,
        height: 0.34,
        baseWeight: 2.0,
        kind: 'ground'
    },
    {
        id: 'procession-way',
        cls: 2,
        height: 0.36,
        baseWeight: 1.2,
        kind: 'circulation'
    },
    {
        id: 'olive-court',
        cls: 2,
        height: 0.38,
        baseWeight: 1.0,
        kind: 'social'
    },
    { id: 'column-row', cls: 3, height: 0.64, baseWeight: 1.5, kind: 'built' },
    { id: 'broken-wall', cls: 3, height: 0.58, baseWeight: 1.0, kind: 'built' },
    {
        id: 'altar-platform',
        cls: 3,
        height: 0.7,
        baseWeight: 0.8,
        kind: 'social'
    },
    { id: 'temple-roof', cls: 4, height: 0.86, baseWeight: 0.8, kind: 'crown' },
    { id: 'oracle-hill', cls: 4, height: 0.94, baseWeight: 0.45, kind: 'crown' }
];

/** Limestone and aged-marble with shadow-blue; positions are this biome's own semantics. */
const PALETTE = [
    '#f2e8cf', // 0 limestone
    '#d6c7a1', // 1 aged-marble
    '#8b7d6b', // 2 ruin-gray
    '#6f8f3f', // 3 olive-green
    '#c47a3c', // 4 terracotta
    '#ffffff', // 5 sun-white
    '#2e3a59', // 6 shadow-blue
    '#e6b85c' // 7 gold-light
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    'column-row': ['broken-column'],
    'rubble-slope': ['broken-column'],
    'olive-court': ['olive-tree'],
    'altar-platform': ['bronze-brazier', 'laurel-wreath'],
    'temple-roof': ['bronze-brazier', 'eagle'],
    'marble-court': ['statue-fragment'],
    'broken-wall': ['statue-fragment'],
    'procession-way': ['laurel-wreath'],
    'oracle-hill': ['eagle']
};

function deriveWeights(f: AudioFeatures): number[] {
    const monumental = 0.5 + f.energy * 1.6; // energy → temple-roof / oracle-hill / column-row
    const ceremonial = 0.5 + f.danceability * 1.4; // danceability → procession-way / marble-court
    const ruin = 0.6 + (1 - f.valence) * 1.1; // low valence → broken-wall / rubble-slope
    return TILES.map(t => {
        let factor = 1;
        if (t.kind === 'crown' || t.id === 'column-row') {
            factor = monumental;
        } else if (t.kind === 'circulation' || t.id === 'marble-court') {
            factor = ceremonial;
        } else if (t.id === 'broken-wall' || t.id === 'rubble-slope') {
            factor = ruin;
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
    return f.energy < 0.35 ? 'fog' : 'clear';
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

export const ancientAcropolisBiome: Biome = {
    id: 'ancient-acropolis',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'dry-moat',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            propDensity: clamp(0.08 + (features.tempo / 120) * 0.09, 0.06, 0.24)
        };
    },
    placeProps
};
