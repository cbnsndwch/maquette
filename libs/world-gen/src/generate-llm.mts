import {
    audioFeaturesSchema,
    type AudioFeatures,
    type TimeOfDay,
    type WorldSpec
} from '@cbnsndwch/contracts';

import { featuresFromSeed } from './derive.mjs';
import { generateWfcWorld, type GenerateWfcOptions } from './generate-wfc.mjs';
import { FakeLlmClient, type LlmClient } from './llm-client.mjs';
import { PALETTES } from './mykonos.mjs';
import {
    buildLlmPrompt,
    parseWorldBrief,
    type WorldBrief
} from './world-brief.mjs';

/**
 * The LLM generation path (research Stage 3).
 *
 * A model receives the track's audio features and returns a {@link WorldBrief}
 * (palette, mood, density, post-fx). That brief is validated and expanded into a
 * full {@link WorldSpec} by the deterministic WFC layout engine, so the model
 * supplies taste while the solver guarantees a coherent island. The result is
 * tagged `paradigm: 'llm'`. If the model is unreachable or returns something
 * unparseable, it falls back to the pure WFC path (tagged `'wfc'`), so a world
 * is always produced.
 */
export interface GenerateLlmOptions {
    /** The model client. Defaults to an offline, deterministic fake. */
    client?: LlmClient;
    /** Track audio features; omitted fields are filled from the seed. */
    features?: Partial<AudioFeatures>;
}

export interface GenerateLlmResult {
    spec: WorldSpec;
    /** The brief the model returned, or `null` if it fell back to WFC. */
    brief: WorldBrief | null;
}

function resolveFeatures(
    seed: string,
    provided?: Partial<AudioFeatures>
): AudioFeatures {
    return audioFeaturesSchema.parse({
        ...featuresFromSeed(seed),
        ...provided
    });
}

/** Translate a validated brief into WFC generator overrides. */
function briefToOptions(
    brief: WorldBrief,
    features: AudioFeatures
): GenerateWfcOptions {
    const palette =
        brief.palette ??
        (brief.paletteName ? [...PALETTES[brief.paletteName]] : undefined);

    // paletteName doubles as a time-of-day hint (same vocabulary).
    const timeOfDay: TimeOfDay | undefined =
        brief.timeOfDay ?? brief.paletteName;

    return {
        paradigm: 'llm',
        features: { ...features, ...brief.features },
        palette,
        timeOfDay,
        weather: brief.weather,
        postFx: brief.postFx
    };
}

/**
 * Generate a world via the LLM path and return both the spec and the brief.
 * Most callers want {@link generateLlmWorld}.
 */
export async function generateLlmWorldDetailed(
    seed: string,
    options: GenerateLlmOptions = {}
): Promise<GenerateLlmResult> {
    const features = resolveFeatures(seed, options.features);
    const client = options.client ?? new FakeLlmClient(seed, features);
    const prompt = buildLlmPrompt(seed, features);

    try {
        const text = await client.complete(prompt);
        const brief = parseWorldBrief(text);
        return {
            spec: generateWfcWorld(seed, briefToOptions(brief, features)),
            brief
        };
    } catch {
        // The model failed us; still hand back a coherent (pure-WFC) world.
        return {
            spec: generateWfcWorld(seed, { features: options.features }),
            brief: null
        };
    }
}

/** Generate a world via the LLM path. */
export async function generateLlmWorld(
    seed: string,
    options: GenerateLlmOptions = {}
): Promise<WorldSpec> {
    const { spec } = await generateLlmWorldDetailed(seed, options);
    return spec;
}
