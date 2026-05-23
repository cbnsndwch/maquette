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
 * The cyberpunk biome — a dense neon megacity rising from dark canals. It shares
 * nothing with Mykonos but the gradient mechanic: the same WFC engine and class
 * banding (canal → quay → street → tower → spire) produce a totally different
 * world from a totally different vocabulary. This is the proof that biomes
 * generalize beyond the Mediterranean voxel set.
 */

type CyberKind = 'border' | 'ground' | 'social' | 'decay' | 'tower' | 'crown';

interface CyberTile extends BiomeTile {
    baseWeight: number;
    kind: CyberKind;
}

const TILES: readonly CyberTile[] = [
    { id: 'canal', cls: 0, height: 0.05, baseWeight: 0.4, kind: 'border' },
    { id: 'quay', cls: 1, height: 0.16, baseWeight: 1.0, kind: 'ground' },
    { id: 'street', cls: 2, height: 0.3, baseWeight: 2.6, kind: 'ground' },
    { id: 'plaza', cls: 2, height: 0.32, baseWeight: 1.2, kind: 'social' },
    { id: 'market', cls: 2, height: 0.34, baseWeight: 1.4, kind: 'social' },
    { id: 'rubble', cls: 3, height: 0.5, baseWeight: 1.1, kind: 'decay' },
    { id: 'scaffold', cls: 3, height: 0.56, baseWeight: 0.8, kind: 'decay' },
    { id: 'tower', cls: 3, height: 0.72, baseWeight: 2.2, kind: 'tower' },
    { id: 'highrise', cls: 4, height: 0.9, baseWeight: 1.4, kind: 'crown' },
    { id: 'spire', cls: 4, height: 1.0, baseWeight: 0.6, kind: 'crown' }
];

/** Dark base with neon accents; positions are this biome's own semantics. */
const PALETTE = [
    '#0a0a14', // 0 structure / near-black
    '#ff2e88', // 1 neon magenta
    '#00e5ff', // 2 neon cyan
    '#7a3cff', // 3 neon purple
    '#1b2030', // 4 dark slate (decay)
    '#2a3550', // 5 steel street
    '#05101f', // 6 canal
    '#120a24' // 7 night sky
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    tower: ['neon-sign', 'antenna'],
    highrise: ['neon-sign', 'antenna'],
    spire: ['antenna', 'beacon'],
    plaza: ['holo', 'drone', 'barrier'],
    market: ['holo', 'barrier'],
    street: ['barrier', 'neon-lamp']
};

function deriveWeights(f: AudioFeatures): number[] {
    const built = 0.5 + f.energy * 1.7; // energy → towers/spires
    const social = 0.5 + f.danceability * 1.6; // danceability → plazas/markets
    const decay = 0.6 + (1 - f.valence) * 1.2; // low valence → rubble/scaffold
    return TILES.map(t => {
        let factor = 1;
        if (t.kind === 'tower' || t.kind === 'crown') {
            factor = built;
        } else if (t.kind === 'social') {
            factor = social;
        } else if (t.kind === 'decay') {
            factor = decay;
        }
        return Math.max(0.01, t.baseWeight * factor);
    });
}

function deriveTimeOfDay(f: AudioFeatures): TimeOfDay {
    return f.valence >= 0.6 ? 'dusk' : 'night';
}

function deriveWeather(f: AudioFeatures): Weather {
    if (f.energy < 0.35) {
        return 'fog';
    }
    if (f.valence < 0.35 && f.energy > 0.6) {
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

export const cyberpunkBiome: Biome = {
    id: 'cyberpunk',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'canal',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: deriveTimeOfDay(features),
            weather: deriveWeather(features),
            propDensity: clamp(0.1 + (features.tempo / 120) * 0.08, 0.06, 0.26)
        };
    },
    placeProps
};
