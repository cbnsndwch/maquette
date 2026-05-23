import {
    TILE_TYPES,
    createRng,
    type AudioFeatures,
    type TimeOfDay,
    type Weather
} from '@cbnsndwch/contracts';

import { BASE_WEIGHTS, PALETTES } from './mykonos.mjs';

/**
 * Maps {@link AudioFeatures} onto the knobs the WFC generator needs: per-tile
 * weights, palette, time of day, weather, and prop density. This is where "what
 * a song sounds like" becomes "what its island looks like".
 */

export interface WorldKnobs {
    /** WFC tile weights, indexed by tile id (TILE_TYPES order). */
    weights: number[];
    palette: string[];
    timeOfDay: TimeOfDay;
    weather: Weather;
    /** Base probability a buildable tile spawns a prop, 0..1. */
    propDensity: number;
}

/** valence × energy → time of day. */
function deriveTimeOfDay(f: AudioFeatures): TimeOfDay {
    const bright = f.valence >= 0.5;
    const lively = f.energy >= 0.5;
    if (bright && lively) {
        return 'day';
    }
    if (bright && !lively) {
        return 'dawn';
    }
    if (!bright && lively) {
        return 'dusk';
    }
    return 'night';
}

/** energy / acousticness / valence → weather. */
function deriveWeather(f: AudioFeatures): Weather {
    if (f.energy < 0.3 && f.acousticness > 0.6) {
        return 'fog';
    }
    if (f.valence < 0.35 && f.energy > 0.6) {
        return 'rain';
    }
    if (f.energy < 0.5) {
        return 'cloudy';
    }
    return 'clear';
}

/**
 * Scales the base tile weights by audio features:
 * - energy lifts the built town (plaza/path/wall/rooftop/dome),
 * - acousticness lifts nature (grass/rock),
 * - danceability widens the plazas.
 */
function deriveWeights(f: AudioFeatures): number[] {
    const built = 0.5 + f.energy * 1.5;
    const nature = 0.6 + f.acousticness * 1.0;
    const plaza = 0.5 + f.danceability * 1.5;
    const beach = 0.7 + f.valence * 0.8;

    const scale: Partial<Record<keyof typeof BASE_WEIGHTS, number>> = {
        sand: beach,
        grass: nature,
        rock: nature,
        plaza: built * plaza,
        path: built,
        wall: built,
        rooftop: built,
        dome: built
    };

    return TILE_TYPES.map(type => {
        const base = BASE_WEIGHTS[type];
        const factor = scale[type] ?? 1;
        return Math.max(0.01, base * factor);
    });
}

export function deriveKnobs(features: AudioFeatures): WorldKnobs {
    const timeOfDay = deriveTimeOfDay(features);
    return {
        weights: deriveWeights(features),
        palette: [...PALETTES[timeOfDay]],
        timeOfDay,
        weather: deriveWeather(features),
        propDensity: clamp(0.06 + (features.tempo / 120) * 0.06, 0.04, 0.2)
    };
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

/**
 * Synthesize plausible, deterministic {@link AudioFeatures} from a seed alone,
 * so a track id with no real Spotify data still maps to a stable, varied world.
 */
export function featuresFromSeed(seed: string): AudioFeatures {
    const rng = createRng(`${seed}:features`);
    return {
        valence: round(rng()),
        energy: round(rng()),
        danceability: round(rng()),
        acousticness: round(rng()),
        instrumentalness: round(rng()),
        tempo: Math.round(70 + rng() * 100)
    };
}

function round(v: number): number {
    return Number(v.toFixed(3));
}
