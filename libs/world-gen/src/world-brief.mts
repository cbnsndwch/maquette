import {
    PALETTE_SIZE,
    audioFeaturesSchema,
    hexColorSchema,
    postFxSchema,
    timeOfDaySchema,
    weatherSchema,
    type AudioFeatures
} from '@cbnsndwch/contracts';
import { z } from 'zod';

/**
 * The WorldBrief — the compact, schema-constrained creative direction the LLM
 * path asks a model to emit.
 *
 * Rather than have the model hand-author a 14×14×2 grid (token-heavy and
 * error-prone), it emits a small brief: a vibe, a palette, a mood, and density
 * hints. The generator then expands that into a full {@link WorldSpec} using the
 * deterministic WFC layout engine. This keeps the LLM doing what it is good at
 * (taste and theming) and the solver doing what it is good at (coherent layout),
 * exactly the "swap paradigms behind the WorldSpec contract" design.
 */
export const worldBriefSchema = z.object({
    /** A one-line description of the world's mood; for logging/sharing. */
    vibe: z.string().max(280).optional(),
    /** Pick a named palette family, or supply 8 hex colors directly. */
    paletteName: z.enum(['day', 'dawn', 'dusk', 'night']).optional(),
    palette: z.array(hexColorSchema).length(PALETTE_SIZE).optional(),
    timeOfDay: timeOfDaySchema.optional(),
    weather: weatherSchema.optional(),
    /** Density/structure hints, reusing the audio-feature vocabulary (0..1). */
    features: audioFeaturesSchema.partial().optional(),
    /** Aesthetic post-processing toggles. */
    postFx: postFxSchema.partial().optional()
});

export type WorldBrief = z.infer<typeof worldBriefSchema>;

export interface LlmPrompt {
    system: string;
    user: string;
}

const SYSTEM_PROMPT = `You are the art director for "Musicologia", which turns a song into a tiny \
Cycladic (Mykonos-style) island world. Given a track's audio features, you choose the world's \
mood and look. Respond with ONLY a single JSON object — no prose, no markdown fences — matching \
this shape (all fields optional, omit any you don't want to set):

{
  "vibe": "a short evocative sentence",
  "paletteName": "day" | "dawn" | "dusk" | "night",
  "palette": ["#rrggbb", ... exactly 8 colors: whitewash, accent, terracotta, olive, dust, sand, sea, sky],
  "timeOfDay": "dawn" | "day" | "dusk" | "night",
  "weather": "clear" | "cloudy" | "rain" | "fog",
  "features": { "energy": 0..1, "acousticness": 0..1, "danceability": 0..1, "valence": 0..1, "tempo": bpm },
  "postFx": { "kuwahara": bool, "dither": bool, "paletteQuantize": int, "toonOutline": bool }
}

Guidance: bright/happy songs → day or dawn with clear skies; dark/intense → dusk or night, maybe rain; \
acoustic/calm → more nature and fog; energetic/danceable → a denser whitewashed town. Prefer "paletteName" \
over a custom "palette" unless the song clearly calls for unusual colors.`;

/** Build the system + user messages for a given track. */
export function buildLlmPrompt(
    seed: string,
    features: AudioFeatures
): LlmPrompt {
    const user = `Track: ${seed}
Audio features:
- valence (positivity): ${features.valence}
- energy: ${features.energy}
- danceability: ${features.danceability}
- acousticness: ${features.acousticness}
- instrumentalness: ${features.instrumentalness}
- tempo: ${features.tempo} BPM

Design this track's island. Return only the JSON brief.`;

    return { system: SYSTEM_PROMPT, user };
}

/**
 * Extract the first JSON object from a model response, tolerating markdown
 * fences and surrounding prose. Returns the parsed value or throws.
 */
export function extractJson(text: string): unknown {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fence?.[1] ?? text;

    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) {
        throw new Error('no JSON object found in model response');
    }
    return JSON.parse(candidate.slice(start, end + 1));
}

/** Parse model text into a validated {@link WorldBrief} (throws on failure). */
export function parseWorldBrief(text: string): WorldBrief {
    return worldBriefSchema.parse(extractJson(text));
}
