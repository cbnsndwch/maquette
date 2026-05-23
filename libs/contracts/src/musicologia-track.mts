import { z } from 'zod';

// ---------------------------------------------------------------------------
// Embedded sub-schemas (mirror the Musicologia server's TrackDna document)
// ---------------------------------------------------------------------------

export const musicologiaPaletteSchema = z.object({
    primary: z.string(),
    secondary: z.string(),
    accent: z.string(),
    background: z.string(),
    text: z.string(),
    grain: z.number(),
    contrast: z.enum(['low', 'medium', 'high']),
    mood: z.enum(['warm', 'cool', 'neutral'])
});

export const musicologiaMotionProfileSchema = z.object({
    speed: z.number(),
    cameraAggression: z.number(),
    particleDensity: z.number(),
    jitter: z.number(),
    bloomIntensity: z.number()
});

export const musicologiaSceneGrammarSchema = z.object({
    primaryMotif: z.string(),
    transitionStyle: z.string()
});

export const musicologiaSectionSchema = z.object({
    startMs: z.number(),
    endMs: z.number(),
    type: z.string(),
    label: z.string().optional()
});

export const musicologiaLyricLineSchema = z.object({
    startMs: z.number(),
    endMs: z.number(),
    text: z.string(),
    emphasis: z.string().optional()
});

export const musicologiaLoreSchema = z.object({
    tagline: z.string().optional(),
    story: z.string().optional(),
    trivia: z.array(z.string()).optional(),
    themes: z.array(z.string()).optional(),
    credits: z
        .array(z.object({ role: z.string(), name: z.string() }))
        .optional(),
    personalNotes: z.string().optional()
});

// ---------------------------------------------------------------------------
// Root schema — matches the JSON returned by GET /api/tracks/by-spotify/:id
// ---------------------------------------------------------------------------

export const musicologiaTrackSchema = z.object({
    _id: z.string(),
    title: z.string(),
    artist: z.string(),
    album: z.string().optional(),
    artistSlug: z.string(),
    trackSlug: z.string(),
    coverUrl: z.string().optional(),
    durationMs: z.number(),
    source: z.string().optional(),
    spotifyTrackId: z.string().nullable().optional(),
    mbRecordingId: z.string().nullable().optional(),
    mbReleaseId: z.string().nullable().optional(),
    previewUrl: z.string().optional(),
    isInstrumental: z.boolean().optional(),

    // Audio features (estimated from MusicBrainz tags)
    tempo: z.number(),
    timeSignature: z.number(),
    key: z.number().int().min(0).max(11),
    mode: z.number().int().min(0).max(1),
    energy: z.number().min(0).max(1),
    valence: z.number().min(0).max(1),
    audioFeaturesEstimated: z.boolean().optional(),
    audioFeaturesSource: z
        .enum(['musicbrainz', 'musicbrainz-tags', 'default'])
        .optional(),

    // Aesthetic / visual identity
    palette: musicologiaPaletteSchema,
    materialLanguage: z.string().optional(),
    motionProfile: musicologiaMotionProfileSchema,
    sceneGrammar: musicologiaSceneGrammarSchema,

    // Time-structured content
    sections: z.array(musicologiaSectionSchema).optional(),
    lyrics: z.array(musicologiaLyricLineSchema).optional(),

    // Enriched narrative lore
    lore: musicologiaLoreSchema.optional(),

    createdAt: z.string().optional(),
    updatedAt: z.string().optional()
});

export type MusicologiaPalette = z.infer<typeof musicologiaPaletteSchema>;
export type MusicologiaMotionProfile = z.infer<
    typeof musicologiaMotionProfileSchema
>;
export type MusicologiaSceneGrammar = z.infer<
    typeof musicologiaSceneGrammarSchema
>;
export type MusicologiaSection = z.infer<typeof musicologiaSectionSchema>;
export type MusicologiaLyricLine = z.infer<typeof musicologiaLyricLineSchema>;
export type MusicologiaLore = z.infer<typeof musicologiaLoreSchema>;
export type MusicologiaTrack = z.infer<typeof musicologiaTrackSchema>;

/** Parse and validate unknown input into MusicologiaTrack, throwing on failure. */
export function validateMusicologiaTrack(input: unknown): MusicologiaTrack {
    return musicologiaTrackSchema.parse(input);
}
