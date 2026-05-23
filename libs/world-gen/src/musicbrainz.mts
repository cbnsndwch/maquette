/**
 * MusicBrainz enrichment: the Musicologia track descriptor carries an
 * `mbRecordingId`/`mbReleaseId` but no genre or origin, which is exactly the
 * signal {@link selectBiome} wants. This module turns a recording MBID into a
 * `{ genres, origin }` affinity by querying the public MusicBrainz web service
 * (recording → genres + artist-credit, then artist → country/area + genres).
 *
 * MusicBrainz requires a descriptive `User-Agent` and rate-limits anonymous
 * callers to ~1 req/s, so calls are serialized with a small gap and results are
 * cached per recording MBID. Every failure path returns `null` so the caller
 * simply falls back to mood-only selection.
 */

export interface MusicBrainzAffinities {
    /** De-duplicated, lowercased genre names, most-voted first. */
    genres: string[];
    /** Artist area name (preferred) or ISO country, lowercased. */
    origin?: string;
}

export interface MusicBrainzClientOptions {
    /** Required by MusicBrainz; identifies the app + a contact. */
    userAgent?: string;
    /** Override the service root (e.g. a mirror). No trailing slash. */
    baseUrl?: string;
    /** Minimum gap between requests, ms. MusicBrainz allows ~1 req/s. */
    minDelayMs?: number;
    /** Injectable fetch for tests. Defaults to global `fetch`. */
    fetchImpl?: typeof fetch;
}

const DEFAULT_USER_AGENT =
    'Musicologia-maquette/0.1 ( https://musicologia.de )';
const DEFAULT_BASE_URL = 'https://musicbrainz.org/ws/2';
const DEFAULT_MIN_DELAY_MS = 1100;

interface MbGenre {
    name?: string;
    count?: number;
}

interface MbArtistRef {
    id?: string;
    name?: string;
}

interface MbRecording {
    genres?: MbGenre[];
    tags?: MbGenre[];
    'artist-credit'?: Array<{ artist?: MbArtistRef }>;
}

interface MbArtist {
    country?: string;
    area?: { name?: string };
    genres?: MbGenre[];
}

/** Names ordered by descending vote count, lowercased and de-duplicated. */
function rankNames(...lists: (MbGenre[] | undefined)[]): string[] {
    const totals = new Map<string, number>();
    for (const list of lists) {
        for (const g of list ?? []) {
            const name = g.name?.trim().toLowerCase();
            if (!name) continue;
            totals.set(name, (totals.get(name) ?? 0) + (g.count ?? 1));
        }
    }
    return [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name);
}

export class MusicBrainzClient {
    readonly #userAgent: string;
    readonly #baseUrl: string;
    readonly #minDelayMs: number;
    readonly #fetch: typeof fetch;

    readonly #cache = new Map<string, MusicBrainzAffinities | null>();
    #lastRequest = 0;
    /** Serializes requests so the rate-limit gap is honored under concurrency. */
    #queue: Promise<unknown> = Promise.resolve();

    constructor(options: MusicBrainzClientOptions = {}) {
        this.#userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
        this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(
            /\/$/,
            ''
        );
        this.#minDelayMs = options.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
        this.#fetch = options.fetchImpl ?? globalThis.fetch;
    }

    /**
     * Resolve genres + origin for a recording MBID. Returns `null` when the
     * recording is unknown, the service is unreachable, or no signal is found.
     */
    async enrichByRecording(
        mbRecordingId: string
    ): Promise<MusicBrainzAffinities | null> {
        if (this.#cache.has(mbRecordingId)) {
            return this.#cache.get(mbRecordingId)!;
        }
        const result = await this.#resolve(mbRecordingId);
        this.#cache.set(mbRecordingId, result);
        return result;
    }

    async #resolve(
        mbRecordingId: string
    ): Promise<MusicBrainzAffinities | null> {
        const recording = await this.#get<MbRecording>(
            `recording/${encodeURIComponent(mbRecordingId)}?inc=artist-credits+genres+tags&fmt=json`
        );
        if (!recording) return null;

        const artistId = recording['artist-credit']?.[0]?.artist?.id;
        const artist = artistId
            ? await this.#get<MbArtist>(
                  `artist/${encodeURIComponent(artistId)}?inc=genres&fmt=json`
              )
            : null;

        const genres = rankNames(
            recording.genres,
            artist?.genres,
            recording.tags
        );
        const origin = (artist?.area?.name ?? artist?.country)
            ?.trim()
            .toLowerCase();

        if (genres.length === 0 && !origin) return null;
        return { genres, origin };
    }

    /** Rate-limited, serialized GET that resolves to parsed JSON or null. */
    #get<T>(path: string): Promise<T | null> {
        const run = this.#queue.then(async (): Promise<T | null> => {
            const wait = this.#minDelayMs - (Date.now() - this.#lastRequest);
            if (wait > 0) await delay(wait);
            this.#lastRequest = Date.now();
            try {
                const res = await this.#fetch(`${this.#baseUrl}/${path}`, {
                    headers: {
                        'User-Agent': this.#userAgent,
                        Accept: 'application/json'
                    }
                });
                if (!res.ok) return null;
                return (await res.json()) as T;
            } catch {
                return null;
            }
        });
        // Keep the chain alive even if this link rejects.
        this.#queue = run.catch(() => undefined);
        return run;
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
