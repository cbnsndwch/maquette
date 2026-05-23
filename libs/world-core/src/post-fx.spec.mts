import type { PostFx } from '@cbnsndwch/contracts';
import { describe, expect, it } from 'vitest';

import {
    DITHER_SHADER,
    KUWAHARA_SHADER,
    POSTERIZE_SHADER,
    TOON_OUTLINE_SHADER,
    type ShaderDef
} from './shaders.mjs';
import { hasPostFx, selectPostFxPasses } from './post-fx.mjs';

function postFx(overrides: Partial<PostFx>): PostFx {
    return {
        kuwahara: false,
        dither: false,
        paletteQuantize: 0,
        toonOutline: false,
        ...overrides
    };
}

describe('selectPostFxPasses', () => {
    it('selects nothing when all toggles are off', () => {
        expect(selectPostFxPasses(postFx({}))).toEqual([]);
        expect(hasPostFx(postFx({}))).toBe(false);
    });

    it('treats paletteQuantize > 0 as the posterize pass', () => {
        expect(selectPostFxPasses(postFx({ paletteQuantize: 6 }))).toEqual([
            'posterize'
        ]);
        expect(selectPostFxPasses(postFx({ paletteQuantize: 0 }))).toEqual([]);
    });

    it('orders the chain Kuwahara → posterize → dither → toon outline', () => {
        const all = postFx({
            kuwahara: true,
            dither: true,
            paletteQuantize: 8,
            toonOutline: true
        });
        expect(selectPostFxPasses(all)).toEqual([
            'kuwahara',
            'posterize',
            'dither',
            'toonOutline'
        ]);
        expect(hasPostFx(all)).toBe(true);
    });

    it('keeps only the enabled passes', () => {
        expect(
            selectPostFxPasses(postFx({ kuwahara: true, toonOutline: true }))
        ).toEqual(['kuwahara', 'toonOutline']);
    });
});

describe('shader definitions', () => {
    const shaders: ShaderDef[] = [
        KUWAHARA_SHADER,
        POSTERIZE_SHADER,
        DITHER_SHADER,
        TOON_OUTLINE_SHADER
    ];

    it('each sample the input texture and write a fragment colour', () => {
        for (const s of shaders) {
            expect(s.uniforms).toHaveProperty('tDiffuse');
            expect(s.fragmentShader).toContain('texture2D(tDiffuse');
            expect(s.fragmentShader).toContain('gl_FragColor');
            expect(s.vertexShader).toContain('gl_Position');
        }
    });

    it('expose the level uniform for quantizing passes', () => {
        expect(
            POSTERIZE_SHADER.uniforms.levels?.value as number
        ).toBeGreaterThan(0);
        expect(DITHER_SHADER.uniforms.levels?.value as number).toBeGreaterThan(
            0
        );
    });
});
