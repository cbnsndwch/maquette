import {
    NEUTRAL_AUDIO_FEATURES,
    worldSpecSchema,
    type AudioFeatures
} from '@cbnsndwch/contracts';
import { describe, expect, it } from 'vitest';

import { generateLlmWorld, generateLlmWorldDetailed } from './generate-llm.mjs';
import { FakeLlmClient, type LlmClient } from './llm-client.mjs';
import { extractJson, parseWorldBrief } from './world-brief.mjs';

const FEATURES: AudioFeatures = {
    ...NEUTRAL_AUDIO_FEATURES,
    valence: 0.9,
    energy: 0.8,
    tempo: 128
};

/** A client that always returns the given text. */
function fixedClient(text: string): LlmClient {
    return { complete: () => Promise.resolve(text) };
}

describe('extractJson', () => {
    it('parses bare JSON', () => {
        expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    });

    it('parses JSON inside markdown fences', () => {
        expect(extractJson('here:\n```json\n{"a":2}\n```\ndone')).toEqual({
            a: 2
        });
    });

    it('parses JSON surrounded by prose', () => {
        expect(extractJson('Sure! {"a":3} hope that helps')).toEqual({ a: 3 });
    });

    it('throws when there is no object', () => {
        expect(() => extractJson('no json here')).toThrow();
    });
});

describe('parseWorldBrief', () => {
    it('validates a well-formed brief', () => {
        const brief = parseWorldBrief(
            '{"paletteName":"dusk","weather":"rain"}'
        );
        expect(brief.paletteName).toBe('dusk');
        expect(brief.weather).toBe('rain');
    });

    it('rejects an invalid palette name', () => {
        expect(() => parseWorldBrief('{"paletteName":"chartreuse"}')).toThrow();
    });
});

describe('generateLlmWorld', () => {
    it('produces a schema-valid world tagged as the llm paradigm', async () => {
        const spec = await generateLlmWorld('track:abc', {
            client: new FakeLlmClient('track:abc', FEATURES),
            features: FEATURES
        });
        expect(() => worldSpecSchema.parse(spec)).not.toThrow();
        expect(spec.paradigm).toBe('llm');
    });

    it('is deterministic for the same seed and client', async () => {
        const make = () =>
            generateLlmWorld('track:abc', {
                client: new FakeLlmClient('track:abc', FEATURES),
                features: FEATURES
            });
        expect(await make()).toEqual(await make());
    });

    it('applies the brief: paletteName drives the palette', async () => {
        const { spec, brief } = await generateLlmWorldDetailed('track:xyz', {
            client: fixedClient('{"paletteName":"night","weather":"fog"}'),
            features: FEATURES
        });
        expect(brief?.paletteName).toBe('night');
        expect(spec.timeOfDay).toBe('night');
        expect(spec.weather).toBe('fog');
        // The night palette's sea slot (index 6) differs from the day default.
        expect(spec.palette[6]).toBe('#1c4a66');
    });

    it('honours postFx toggles from the brief', async () => {
        const { spec } = await generateLlmWorldDetailed('track:fx', {
            client: fixedClient(
                '{"paletteName":"day","postFx":{"kuwahara":true,"dither":true}}'
            ),
            features: FEATURES
        });
        expect(spec.postFx.kuwahara).toBe(true);
        expect(spec.postFx.dither).toBe(true);
    });

    it('falls back to a pure WFC world when the model output is unusable', async () => {
        const { spec, brief } = await generateLlmWorldDetailed('track:bad', {
            client: fixedClient('I am a chatty model with no JSON.'),
            features: FEATURES
        });
        expect(brief).toBeNull();
        expect(spec.paradigm).toBe('wfc');
        expect(() => worldSpecSchema.parse(spec)).not.toThrow();
    });

    it('works offline with the default fake client', async () => {
        const spec = await generateLlmWorld('track:offline');
        expect(spec.paradigm).toBe('llm');
        expect(() => worldSpecSchema.parse(spec)).not.toThrow();
    });
});
