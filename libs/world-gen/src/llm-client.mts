import { createRng, type AudioFeatures } from '@cbnsndwch/contracts';

import type { LlmPrompt, WorldBrief } from './world-brief.mjs';

/**
 * The minimal contract the LLM path depends on: turn a prompt into text. Keeping
 * it this small means the generator is testable with a fake and provider-neutral
 * (Anthropic, OpenAI-compatible, local, etc.).
 */
export interface LlmClient {
    complete(prompt: LlmPrompt): Promise<string>;
}

/**
 * A deterministic, offline stand-in for a real model. It ignores the prompt text
 * and instead derives a plausible {@link WorldBrief} from the seed/features baked
 * into it, returning it as JSON — exactly what a well-behaved model would. Use it
 * in tests and offline demos so the full parse → validate → expand pipeline runs
 * without a network or API key.
 */
export class FakeLlmClient implements LlmClient {
    constructor(
        private readonly seed: string,
        private readonly features: AudioFeatures
    ) {}

    complete(_prompt: LlmPrompt): Promise<string> {
        const rng = createRng(`${this.seed}:fake-llm`);
        const f = this.features;

        const paletteName =
            f.valence >= 0.5
                ? f.energy >= 0.5
                    ? 'day'
                    : 'dawn'
                : f.energy >= 0.5
                  ? 'dusk'
                  : 'night';

        const weather =
            f.acousticness > 0.6 && f.energy < 0.4
                ? 'fog'
                : f.energy > 0.7
                  ? 'clear'
                  : 'cloudy';

        const brief: WorldBrief = {
            vibe: `A ${paletteName} island for a track at ${f.tempo} BPM.`,
            paletteName,
            weather,
            features: {
                energy: f.energy,
                acousticness: f.acousticness,
                danceability: f.danceability,
                valence: f.valence
            },
            postFx: {
                kuwahara: rng() > 0.5,
                dither: rng() > 0.5
            }
        };

        // Emit with markdown fences sometimes, to exercise the extractor.
        const json = JSON.stringify(brief, null, 2);
        return Promise.resolve(
            rng() > 0.5 ? '```json\n' + json + '\n```' : json
        );
    }
}
