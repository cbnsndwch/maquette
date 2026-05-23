import { z } from 'zod';

/**
 * AudioFeatures — the generator *input* contract.
 *
 * A normalized, Spotify-style description of a track's character. It is not part
 * of the {@link WorldSpec} (the generator output); rather it is what a generator
 * (WFC or LLM) consumes, together with a seed, to decide palette, density,
 * weather, and time of day. Fields mirror Spotify's audio-features endpoint.
 */

export const audioFeaturesSchema = z.object({
    /** Musical positivity: sad/angry (0) → happy/euphoric (1). */
    valence: z.number().min(0).max(1).default(0.5),
    /** Perceptual intensity and activity: calm (0) → energetic (1). */
    energy: z.number().min(0).max(1).default(0.5),
    /** How suitable for dancing: 0 → 1. */
    danceability: z.number().min(0).max(1).default(0.5),
    /** Confidence the track is acoustic: electronic (0) → acoustic (1). */
    acousticness: z.number().min(0).max(1).default(0.5),
    /** Likelihood the track has no vocals: vocal (0) → instrumental (1). */
    instrumentalness: z.number().min(0).max(1).default(0.5),
    /** Estimated tempo in BPM. */
    tempo: z.number().min(20).max(260).default(120)
});

export type AudioFeatures = z.infer<typeof audioFeaturesSchema>;

/** A neutral, middle-of-the-road feature set (all 0.5, 120 BPM). */
export const NEUTRAL_AUDIO_FEATURES: AudioFeatures = {
    valence: 0.5,
    energy: 0.5,
    danceability: 0.5,
    acousticness: 0.5,
    instrumentalness: 0.5,
    tempo: 120
};

/** Parse and validate unknown input into AudioFeatures, throwing on failure. */
export function validateAudioFeatures(input: unknown): AudioFeatures {
    return audioFeaturesSchema.parse(input);
}
