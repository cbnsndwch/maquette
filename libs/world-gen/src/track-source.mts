import {
    musicologiaTrackSchema,
    type AudioFeatures,
    type MusicologiaTrack
} from '@cbnsndwch/contracts';

import { type GenerateOptions } from './biome.mjs';

// ---------------------------------------------------------------------------
// trackToWorldInputs — maps a Musicologia track descriptor → GenerateOptions
// ---------------------------------------------------------------------------

/**
 * Maps the rich Musicologia track descriptor onto the generator's input knobs.
 *
 * Fields available in the descriptor are used directly; fields that have no
 * equivalent (danceability, acousticness) are approximated from what we do have.
 */
export function trackToWorldInputs(track: MusicologiaTrack): GenerateOptions {
    const features: Partial<AudioFeatures> = {
        energy: track.energy,
        valence: track.valence,
        tempo: track.tempo,
        instrumentalness: track.isInstrumental ? 1 : 0,
        // Major key (mode=1) + high energy → more danceable
        danceability: clamp(
            track.energy * 0.5 + (track.mode === 1 ? 0.3 : 0.1),
            0,
            1
        ),
        // No direct acousticness signal; use 0.5 (neutral) as fallback
        acousticness: 0.5
    };

    return { features };
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// MusicologiaTrackSource — fetches a track descriptor from the Musicologia API
// ---------------------------------------------------------------------------

export interface MusicologiaTrackSourceOptions {
    /** Base URL of the Musicologia server, e.g. https://musicologia.de */
    baseUrl: string;
    /** Value for the x-api-key header (ADMIN_API_KEY on the server). */
    apiKey: string;
}

/**
 * Fetches per-track descriptor data from the Musicologia API and maps it onto
 * generator inputs. Falls through silently when the track is not in the catalog
 * or the server is unreachable — the caller falls back to featuresFromSeed.
 */
export class MusicologiaTrackSource {
    readonly #baseUrl: string;
    readonly #apiKey: string;

    constructor({ baseUrl, apiKey }: MusicologiaTrackSourceOptions) {
        this.#baseUrl = baseUrl.replace(/\/$/, '');
        this.#apiKey = apiKey;
    }

    /** Fetch a descriptor by Spotify track ID. Returns null on any failure. */
    async fetchBySpotifyId(
        spotifyTrackId: string
    ): Promise<MusicologiaTrack | null> {
        return this.#get(
            `/api/tracks/by-spotify/${encodeURIComponent(spotifyTrackId)}`
        );
    }

    /** Fetch a descriptor by artist + track slug. Returns null on any failure. */
    async fetchBySlug(
        artistSlug: string,
        trackSlug: string
    ): Promise<MusicologiaTrack | null> {
        return this.#get(
            `/api/tracks/by-slug/${encodeURIComponent(artistSlug)}/${encodeURIComponent(trackSlug)}`
        );
    }

    /**
     * Resolve GenerateOptions for a Spotify track ID. Returns an empty object
     * (triggering the featuresFromSeed fallback in the generator) when the track
     * is not found or the server is unreachable.
     */
    async getWorldInputs(spotifyTrackId: string): Promise<GenerateOptions> {
        const track = await this.fetchBySpotifyId(spotifyTrackId);
        if (!track) return {};
        return trackToWorldInputs(track);
    }

    async #get(path: string): Promise<MusicologiaTrack | null> {
        try {
            const res = await fetch(`${this.#baseUrl}${path}`, {
                headers: { 'x-api-key': this.#apiKey }
            });
            if (!res.ok) return null;
            const data = await res.json();
            return musicologiaTrackSchema.parse(data);
        } catch {
            return null;
        }
    }
}
