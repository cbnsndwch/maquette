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
 * The rave-festival biome — an outdoor electronic festival erupting from dark
 * ground into laser-crowned stages. Perimeter fences ring dusty fields that give
 * way to dance floors, speaker stacks, and a towering main stage, all lit by
 * neon violet, cyan, and strobe-yellow. Energy drives the vertical crown;
 * danceability opens the floor; valence dims the fence.
 */

type RaveFestivalKind =
    | 'border'
    | 'transition'
    | 'ground'
    | 'social'
    | 'built'
    | 'crown';

interface RaveFestivalTile extends BiomeTile {
    baseWeight: number;
    kind: RaveFestivalKind;
}

const TILES: readonly RaveFestivalTile[] = [
    {
        id: 'perimeter-fence',
        cls: 0,
        height: 0.08,
        baseWeight: 0.45,
        kind: 'border'
    },
    {
        id: 'dust-buffer',
        cls: 1,
        height: 0.16,
        baseWeight: 0.9,
        kind: 'transition'
    },
    {
        id: 'festival-field',
        cls: 2,
        height: 0.26,
        baseWeight: 2.5,
        kind: 'ground'
    },
    { id: 'walkway', cls: 2, height: 0.3, baseWeight: 1.3, kind: 'social' },
    {
        id: 'dance-floor',
        cls: 2,
        height: 0.34,
        baseWeight: 2.0,
        kind: 'social'
    },
    { id: 'tent-camp', cls: 3, height: 0.48, baseWeight: 1.0, kind: 'built' },
    { id: 'vendor-row', cls: 3, height: 0.52, baseWeight: 0.9, kind: 'built' },
    {
        id: 'speaker-stack',
        cls: 3,
        height: 0.7,
        baseWeight: 1.2,
        kind: 'built'
    },
    { id: 'laser-tower', cls: 4, height: 0.88, baseWeight: 0.8, kind: 'crown' },
    { id: 'main-stage', cls: 4, height: 1.0, baseWeight: 0.7, kind: 'crown' }
];

/** Dark night-festival palette; violet/cyan/magenta neon over near-black ground. */
const PALETTE = [
    '#090914', // 0 night-black
    '#7f2cff', // 1 electric-violet
    '#00f5ff', // 2 laser-cyan
    '#ff2bd6', // 3 hot-magenta
    '#f6f06d', // 4 strobe-yellow
    '#222436', // 5 stage-steel
    '#5a4a37', // 6 dust-earth
    '#f4f4f8' // 7 tent-white
] as const;

const PROPS_BY_TILE: Record<string, readonly string[]> = {
    'laser-tower': ['laser-beam'],
    'main-stage': ['laser-beam', 'subwoofer', 'light-rig'],
    'speaker-stack': ['subwoofer', 'light-rig'],
    'vendor-row': ['food-truck'],
    'tent-camp': ['flag'],
    walkway: ['flag'],
    'dance-floor': ['crowd-cluster'],
    'festival-field': ['crowd-cluster']
};

function deriveWeights(f: AudioFeatures): number[] {
    const crown = 0.5 + f.energy * 1.8; // energy → speaker-stack / laser-tower / main-stage
    const floor = 0.5 + f.danceability * 1.6; // danceability → dance-floor / walkway
    const fence = 0.6 + (1 - f.valence) * 1.2; // low valence → more perimeter-fence / dust-buffer
    return TILES.map(t => {
        let factor = 1;
        if (t.kind === 'crown' || t.id === 'speaker-stack') {
            factor = crown;
        } else if (t.kind === 'social') {
            factor = floor;
        } else if (t.kind === 'border' || t.kind === 'transition') {
            factor = fence;
        }
        return Math.max(0.01, t.baseWeight * factor);
    });
}

function deriveWeather(f: AudioFeatures): 'clear' | 'fog' {
    // Very low valence → ominous fog; otherwise lasers need clear skies
    if (f.valence < 0.25) {
        return 'fog';
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

export const raveFestivalBiome: Biome = {
    id: 'rave-festival',
    tiles: TILES.map(({ id, cls, height }): BiomeTile => ({ id, cls, height })),
    borderTileId: 'perimeter-fence',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return {
            weights: deriveWeights(features),
            palette: [...PALETTE],
            timeOfDay: 'night',
            weather: deriveWeather(features),
            // rave = dense props; tempo drives density, clamped 0.12..0.30
            propDensity: clamp(0.12 + (features.tempo / 120) * 0.1, 0.12, 0.3)
        };
    },
    placeProps
};
