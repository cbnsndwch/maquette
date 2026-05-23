import {
    musicologiaTrackSchema,
    type AudioFeatures,
    type MusicologiaTrack
} from '@cbnsndwch/contracts';

import { type GenerateOptions } from './biome.mjs';
import { type GenerateWfcOptions } from './generate-wfc.mjs';
import { MusicBrainzClient } from './musicbrainz.mjs';
import { selectBiome, type TrackAffinities } from './select-biome.mjs';

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
    /**
     * Enrich biome selection with MusicBrainz genres + artist origin (the API
     * descriptor carries neither). Defaults to true; set false for a fully
     * offline, mood-only selection. Ignored when a track has no mbRecordingId.
     */
    enrichWithMusicBrainz?: boolean;
    /** Injectable MusicBrainz client (tests/offline). */
    musicBrainz?: MusicBrainzClient;
}

/**
 * Fetches per-track descriptor data from the Musicologia API and maps it onto
 * generator inputs. Falls through silently when the track is not in the catalog
 * or the server is unreachable — the caller falls back to featuresFromSeed.
 */
export class MusicologiaTrackSource {
    readonly #baseUrl: string;
    readonly #apiKey: string;
    readonly #enrich: boolean;
    readonly #mb: MusicBrainzClient;

    constructor({
        baseUrl,
        apiKey,
        enrichWithMusicBrainz = true,
        musicBrainz
    }: MusicologiaTrackSourceOptions) {
        this.#baseUrl = baseUrl.replace(/\/$/, '');
        this.#apiKey = apiKey;
        this.#enrich = enrichWithMusicBrainz;
        this.#mb = musicBrainz ?? new MusicBrainzClient();
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
     * Resolve generator inputs for a Spotify track ID: maps audio features and
     * selects a biome (genres/origin enriched via MusicBrainz when available,
     * otherwise mood-only). Returns an empty object — triggering the
     * featuresFromSeed + default-biome fallback — when the track is not found
     * or the server is unreachable.
     */
    async getWorldInputs(spotifyTrackId: string): Promise<GenerateWfcOptions> {
        const track = await this.fetchBySpotifyId(spotifyTrackId);
        if (!track) return {};

        const affinities = await this.resolveAffinities(track);
        return {
            ...trackToWorldInputs(track),
            biomeId: selectBiome(affinities)
        };
    }

    /**
     * Build the selection signal for a track: mood (energy/valence/tempo) and
     * lore themes always; genres + artist origin added from MusicBrainz when
     * enrichment is on and the track has a recording MBID.
     */
    async resolveAffinities(track: MusicologiaTrack): Promise<TrackAffinities> {
        const affinities: TrackAffinities = {
            energy: track.energy,
            valence: track.valence,
            tempo: track.tempo,
            danceability: clamp(
                track.energy * 0.5 + (track.mode === 1 ? 0.3 : 0.1),
                0,
                1
            ),
            tags: track.lore?.themes ?? []
        };

        if (this.#enrich && track.mbRecordingId) {
            const mb = await this.#mb.enrichByRecording(track.mbRecordingId);
            if (mb) {
                affinities.genres = mb.genres;
                if (mb.origin) affinities.origin = mb.origin;
            }
        }

        return affinities;
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
