import type { PostFx, WorldSpec } from '@cbnsndwch/contracts';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

import {
    DITHER_SHADER,
    KUWAHARA_SHADER,
    POSTERIZE_SHADER,
    TOON_OUTLINE_SHADER,
    type ShaderDef
} from './shaders.mjs';

/**
 * Assembles the Stage 4 aesthetic pass: a Kuwahara painterly filter, palette
 * quantization, a Bayer ordered-dither, and a toon outline — each toggled by the
 * world's {@link PostFx}. The chain order follows the research doc:
 * Kuwahara → palette-quantize → dither → toon outline.
 */

export type PostFxPassName =
    | 'kuwahara'
    | 'posterize'
    | 'dither'
    | 'toonOutline';

/** Canonical chain order. */
const PASS_ORDER: readonly PostFxPassName[] = [
    'kuwahara',
    'posterize',
    'dither',
    'toonOutline'
];

/**
 * Which passes a given {@link PostFx} enables, in chain order. Pure and
 * GPU-free, so the selection logic is unit-testable.
 */
export function selectPostFxPasses(postFx: PostFx): PostFxPassName[] {
    const enabled: Record<PostFxPassName, boolean> = {
        kuwahara: postFx.kuwahara,
        posterize: postFx.paletteQuantize > 0,
        dither: postFx.dither,
        toonOutline: postFx.toonOutline
    };
    return PASS_ORDER.filter(name => enabled[name]);
}

/** Is any post-processing active for this world? */
export function hasPostFx(postFx: PostFx): boolean {
    return selectPostFxPasses(postFx).length > 0;
}

const SHADER_FOR: Record<PostFxPassName, ShaderDef> = {
    kuwahara: KUWAHARA_SHADER,
    posterize: POSTERIZE_SHADER,
    dither: DITHER_SHADER,
    toonOutline: TOON_OUTLINE_SHADER
};

export interface PostFxOptions {
    width?: number;
    height?: number;
    pixelRatio?: number;
}

export interface PostFxChain {
    composer: EffectComposer;
    /** Render one frame through the chain. */
    render(): void;
    /** Resize the chain's buffers and resolution uniforms. */
    setSize(width: number, height: number): void;
    /** Free GPU resources. */
    dispose(): void;
}

/**
 * Build an {@link EffectComposer} for a world. If the spec enables no passes the
 * chain still works (just a render + output), so callers can use it
 * unconditionally. Requires a live `WebGLRenderer`, so it is not unit-tested;
 * see {@link selectPostFxPasses} for the GPU-free logic.
 */
export function createPostFx(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    spec: WorldSpec,
    options: PostFxOptions = {}
): PostFxChain {
    const size = renderer.getSize(new THREE.Vector2());
    const width = options.width ?? size.x;
    const height = options.height ?? size.y;

    const composer = new EffectComposer(renderer);
    if (options.pixelRatio !== undefined) {
        composer.setPixelRatio(options.pixelRatio);
    }
    composer.setSize(width, height);
    composer.addPass(new RenderPass(scene, camera));

    // Passes whose `resolution` uniform must track the viewport.
    const resolutionPasses: ShaderPass[] = [];
    const quantize = spec.postFx.paletteQuantize;

    for (const name of selectPostFxPasses(spec.postFx)) {
        const pass = new ShaderPass(SHADER_FOR[name]);
        const levels = pass.uniforms.levels;
        if (name === 'posterize' && levels) {
            levels.value = quantize;
        }
        if (name === 'dither' && levels) {
            levels.value = quantize > 0 ? quantize : 4;
        }
        if (pass.uniforms.resolution) {
            resolutionPasses.push(pass);
        }
        composer.addPass(pass);
    }

    composer.addPass(new OutputPass());

    const applyResolution = (w: number, h: number) => {
        for (const pass of resolutionPasses) {
            const resolution = pass.uniforms.resolution;
            if (resolution) {
                (resolution.value as THREE.Vector2).set(w, h);
            }
        }
    };
    applyResolution(width, height);

    return {
        composer,
        render: () => composer.render(),
        setSize: (w, h) => {
            composer.setSize(w, h);
            applyResolution(w, h);
        },
        dispose: () => composer.dispose()
    };
}
