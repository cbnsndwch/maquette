import { DEFAULT_BIOME_ID } from './biome-registry.mjs';

export interface TrackAffinities {
    /** MusicBrainz-style genre/tag strings, e.g. ['afro-cuban', 'son-cubano'] */
    genres?: string[];
    /** Freeform style/mood tags */
    tags?: string[];
    /** Artist country or region, e.g. 'Cuba', 'Japan', 'Nordic' */
    origin?: string;
    /** AudioFeatures from the WFC engine, if available */
    energy?: number; // 0..1
    valence?: number; // 0..1
    danceability?: number; // 0..1
    tempo?: number; // BPM
}

export interface BiomeScore {
    id: string;
    score: number; // 0..1 normalized
}

// 5-point mood scale → midpoint numeric value
const MOOD: Record<
    'low' | 'medium-low' | 'medium' | 'medium-high' | 'high',
    number
> = {
    low: 0.15,
    'medium-low': 0.3,
    medium: 0.5,
    'medium-high': 0.7,
    high: 0.85
};

const BIOME_AFFINITIES: Array<{
    id: string;
    genres: string[];
    tags: string[];
    origins: string[];
    valence: number;
    energy: number;
}> = [
    {
        id: 'mykonos',
        genres: ['greek', 'mediterranean', 'lounge', 'world-music'],
        tags: ['relaxed', 'sunny', 'coastal', 'holiday'],
        origins: ['greece', 'mediterranean'],
        valence: MOOD['high'],
        energy: MOOD['medium-low']
    },
    {
        id: 'cyberpunk',
        genres: [
            'industrial',
            'synthwave',
            'darksynth',
            'electro',
            'ebm',
            'metal'
        ],
        tags: ['dark', 'futuristic', 'aggressive', 'urban', 'dystopian'],
        origins: ['global', 'japan', 'south korea', 'uk'],
        valence: MOOD['low'],
        energy: MOOD['high']
    },
    {
        id: 'cuban-beach',
        genres: ['afro-cuban', 'son-cubano', 'timba', 'rumba', 'latin-jazz'],
        tags: ['tropical', 'warm', 'coastal', 'sunny', 'relaxed'],
        origins: ['cuba', 'caribbean'],
        valence: MOOD['high'],
        energy: MOOD['medium']
    },
    {
        id: 'tobacco-plantation',
        genres: ['son-cubano', 'rumba', 'guajira', 'trova', 'campesino'],
        tags: ['rural', 'pastoral', 'warm', 'earthy', 'nostalgic'],
        origins: ['cuba', 'viñales', 'pinar del río'],
        valence: MOOD['medium-high'],
        energy: MOOD['medium-low']
    },
    {
        id: 'spanish-colonial',
        genres: ['trova', 'bolero', 'salsa', 'son-cubano'],
        tags: ['historic', 'romantic', 'urban', 'warm'],
        origins: ['cuba', 'spain', 'latin america'],
        valence: MOOD['medium-high'],
        energy: MOOD['medium']
    },
    {
        id: 'rave-festival',
        genres: [
            'house',
            'techno',
            'trance',
            'drum-and-bass',
            'psytrance',
            'edm'
        ],
        tags: ['kinetic', 'nightlife', 'neon', 'communal', 'euphoric'],
        origins: ['global', 'uk', 'germany', 'netherlands'],
        valence: MOOD['high'],
        energy: MOOD['high']
    },
    {
        id: 'solarpunk',
        genres: [
            'indie-pop',
            'dream-pop',
            'folk-electronic',
            'chillwave',
            'ambient-pop'
        ],
        tags: ['hopeful', 'organic', 'futuristic', 'warm', 'communal'],
        origins: ['global', 'western europe', 'latin america'],
        valence: MOOD['high'],
        energy: MOOD['medium']
    },
    {
        id: 'bollywood-ghats',
        genres: [
            'bollywood',
            'hindustani-classical',
            'qawwali',
            'bhangra',
            'filmi'
        ],
        tags: ['vibrant', 'sacred', 'festive', 'riverine', 'colorful'],
        origins: ['india', 'south asia', 'varanasi', 'rajasthan'],
        valence: MOOD['high'],
        energy: MOOD['medium-high']
    },
    {
        id: 'jazz-quarter',
        genres: ['jazz', 'soul', 'blues', 'swing', 'funk', 'dixieland'],
        tags: ['smoky', 'urban', 'romantic', 'night', 'soulful'],
        origins: ['new orleans', 'united states', 'france'],
        valence: MOOD['medium-high'],
        energy: MOOD['medium-high']
    },
    {
        id: 'nordic-fjord',
        genres: [
            'nordic-folk',
            'black-metal',
            'ambient',
            'viking-metal',
            'post-rock'
        ],
        tags: ['cold', 'majestic', 'dark', 'mythic', 'remote'],
        origins: ['norway', 'iceland', 'sweden', 'faroe islands'],
        valence: MOOD['medium-low'],
        energy: MOOD['medium-high']
    },
    {
        id: 'tokyo-city-pop',
        genres: ['j-pop', 'city-pop', 'vaporwave', 'future-funk', 'anime-ost'],
        tags: ['urban', 'nostalgic', 'glossy', 'night', 'neon'],
        origins: ['japan', 'tokyo'],
        valence: MOOD['medium-high'],
        energy: MOOD['medium-high']
    },
    {
        id: 'desert-oasis',
        genres: ['arabic-maqam', 'tuareg', 'gnawa', 'rai', 'desert-blues'],
        tags: ['arid', 'mystic', 'warm', 'nomadic', 'ancient'],
        origins: ['morocco', 'mali', 'algeria', 'tunisia', 'sahara'],
        valence: MOOD['medium'],
        energy: MOOD['medium']
    },
    {
        id: 'rio-carnival',
        genres: ['samba', 'forro', 'baile-funk', 'pagode', 'bossa-nova'],
        tags: ['festive', 'tropical', 'colorful', 'rhythmic', 'communal'],
        origins: ['brazil', 'rio de janeiro'],
        valence: MOOD['high'],
        energy: MOOD['high']
    },
    {
        id: 'jungle-canopy',
        genres: [
            'afrobeats',
            'bossa-nova',
            'tropical-house',
            'afro-fusion',
            'world-fusion'
        ],
        tags: ['lush', 'organic', 'humid', 'alive', 'verdant'],
        origins: ['amazon basin', 'west africa', 'brazil', 'southeast asia'],
        valence: MOOD['medium-high'],
        energy: MOOD['medium']
    },
    {
        id: 'arctic-base',
        genres: ['idm', 'drone', 'dark-ambient', 'post-rock', 'glitch'],
        tags: ['cold', 'isolated', 'minimal', 'scientific', 'ethereal'],
        origins: ['arctic', 'antarctica', 'svalbard', 'greenland'],
        valence: MOOD['low'],
        energy: MOOD['medium-low']
    },
    {
        id: 'amazon-river-village',
        genres: [
            'cumbia',
            'chicha',
            'amazonian-folk',
            'tropical-bass',
            'psychedelic-cumbia'
        ],
        tags: ['riverine', 'humid', 'communal', 'earthy', 'tribal'],
        origins: ['peru', 'colombia', 'brazil', 'amazon basin'],
        valence: MOOD['medium-high'],
        energy: MOOD['medium']
    },
    {
        id: 'ancient-acropolis',
        genres: [
            'epic-orchestral',
            'neo-classical',
            'ancient-world-music',
            'choral',
            'byzantine'
        ],
        tags: ['mythic', 'historic', 'sunlit', 'grand', 'contemplative'],
        origins: ['greece', 'rome', 'mediterranean'],
        valence: MOOD['medium-high'],
        energy: MOOD['medium-high']
    },
    {
        id: 'ocean-reef',
        genres: ['ambient', 'lo-fi', 'chillwave', 'surf', 'downtempo'],
        tags: ['aquatic', 'calm', 'luminous', 'floating', 'shimmering'],
        origins: ['great barrier reef', 'caribbean', 'pacific ocean'],
        valence: MOOD['medium-high'],
        energy: MOOD['low']
    },
    {
        id: 'west-african-savanna',
        genres: ['afrobeats', 'highlife', 'kora', 'mbalax', 'afro-fusion'],
        tags: ['warm', 'rhythmic', 'open', 'communal', 'earthy'],
        origins: ['west africa', 'mali', 'senegal', 'ghana', 'nigeria'],
        valence: MOOD['high'],
        energy: MOOD['medium-high']
    },
    {
        id: 'polynesian-atoll',
        genres: [
            'reggae',
            'hawaiian-slack-key',
            'pacific-island',
            'ukulele',
            'island-pop'
        ],
        tags: ['island', 'breezy', 'sunny', 'gentle', 'tropical'],
        origins: ['polynesia', 'hawaii', 'samoa', 'fiji', 'tahiti'],
        valence: MOOD['high'],
        energy: MOOD['medium-low']
    }
];

const MIN_SCORE_THRESHOLD = 0.15;
const SQRT2 = Math.SQRT2;

// Tokens too generic to signal a biome on their own. MusicBrainz genres and the
// biome vocab are full of these ('indie-pop', 'pop rock', 'world-music'), and
// matching on them would tie every pop/rock track to half the catalog.
const GENERIC_TOKENS = new Set([
    'pop',
    'rock',
    'music',
    'world',
    'song',
    'fusion',
    'classic',
    'classical',
    'modern',
    'contemporary',
    'alternative',
    'indie',
    'electronic'
]);

/** Split a genre/tag/theme phrase into its meaningful, non-generic tokens. */
function significantTokens(term: string): string[] {
    return term
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(t => t.length > 0 && !GENERIC_TOKENS.has(t));
}

// Matched track terms that count as a full genre score. A track with a few
// distinctive hits should score well regardless of how many genres/themes the
// enrichment piled on (which would otherwise dilute matches / total).
const GENRE_SATURATION = 3;

function scoreOne(
    biome: (typeof BIOME_AFFINITIES)[number],
    affinities: TrackAffinities
): number {
    // 1. Genre/tag overlap (weight 0.45). Token-based so 'dance-rock' hits
    //    'dance-rock' and the theme 'communal ecstasy' hits a 'communal' tag.
    const trackTerms = [
        ...(affinities.genres ?? []),
        ...(affinities.tags ?? [])
    ];
    const biomeTokenSets = [...biome.genres, ...biome.tags].map(
        t => new Set(significantTokens(t))
    );
    let genreScore = 0;
    if (trackTerms.length > 0) {
        const matches = trackTerms.filter(term =>
            significantTokens(term).some(tok =>
                biomeTokenSets.some(set => set.has(tok))
            )
        ).length;
        genreScore = Math.min(1, matches / GENRE_SATURATION);
    }

    // 2. Origin match (weight 0.25)
    let originScore = 0.5; // neutral if no origin provided
    if (affinities.origin !== undefined) {
        const trackOrigin = affinities.origin.toLowerCase();
        const fullMatch = biome.origins.some(o => o === trackOrigin);
        if (fullMatch) {
            originScore = 1.0;
        } else {
            const partialMatch = biome.origins.some(
                o => o.includes(trackOrigin) || trackOrigin.includes(o)
            );
            originScore = partialMatch ? 0.6 : 0;
        }
    }

    // 3. Mood proximity (weight 0.30)
    const trackValence = affinities.valence ?? 0.5;
    const trackEnergy = affinities.energy ?? 0.5;
    const dv = trackValence - biome.valence;
    const de = trackEnergy - biome.energy;
    const distance = Math.sqrt(dv * dv + de * de) / SQRT2;
    const moodScore = 1 - distance;

    return genreScore * 0.45 + originScore * 0.25 + moodScore * 0.3;
}

/**
 * Score all registered biomes against track affinities and return the full
 * ranked list, highest score first.
 */
export function rankBiomes(affinities: TrackAffinities): BiomeScore[] {
    const raw = BIOME_AFFINITIES.map(b => ({
        id: b.id,
        score: scoreOne(b, affinities)
    }));

    const max = raw.reduce((m, b) => Math.max(m, b.score), 0);
    const normalized =
        max > 0
            ? raw.map(b => ({ id: b.id, score: b.score / max }))
            : raw.map(b => ({ id: b.id, score: 0 }));

    return normalized.sort((a, b) => b.score - a.score);
}

/**
 * Return the single best-matching biome id. Falls back to 'mykonos' if no
 * biome scores above a minimum threshold.
 */
export function selectBiome(affinities: TrackAffinities): string {
    const ranked = rankBiomes(affinities);

    // ranked[0].score is always 1.0 after normalization if any raw score > 0,
    // so re-compute the raw top score to apply the threshold correctly.
    const rawTop = BIOME_AFFINITIES.reduce(
        (m, b) => Math.max(m, scoreOne(b, affinities)),
        0
    );

    if (rawTop < MIN_SCORE_THRESHOLD) {
        return DEFAULT_BIOME_ID;
    }

    return ranked[0]!.id;
}
