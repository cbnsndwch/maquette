import * as THREE from 'three';

/**
 * Full-screen post-processing shaders for the Musicologia aesthetic pass
 * (research Stage 4). Each is a plain `{ uniforms, vertexShader, fragmentShader }`
 * object compatible with three's `ShaderPass`, kept free of renderer state so the
 * definitions can be inspected and unit-tested without a GPU.
 *
 * The look, per the research doc: a Kuwahara painterly pass, palette
 * quantization, a Bayer ordered-dither, and a cheap toon outline.
 */

export interface ShaderDef {
    name: string;
    uniforms: Record<string, { value: unknown }>;
    vertexShader: string;
    fragmentShader: string;
}

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * 4-quadrant Kuwahara filter — the classic painterly smoothing that keeps edges
 * crisp while flattening interiors into brush-stroke-like regions. Each pixel
 * takes the mean of whichever of its four corner neighbourhoods has the lowest
 * colour variance. Radius is a compile-time constant for WebGL1 loop safety.
 */
export const KUWAHARA_SHADER: ShaderDef = {
    name: 'KuwaharaShader',
    uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) }
    },
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */ `
        #define RADIUS 4
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        varying vec2 vUv;

        void main() {
            vec2 px = 1.0 / resolution;
            float count = float((RADIUS + 1) * (RADIUS + 1));

            vec3 sum[4];
            vec3 sumSq[4];
            sum[0] = sum[1] = sum[2] = sum[3] = vec3(0.0);
            sumSq[0] = sumSq[1] = sumSq[2] = sumSq[3] = vec3(0.0);

            for (int i = 0; i <= RADIUS; i++) {
                for (int j = 0; j <= RADIUS; j++) {
                    vec2 d = vec2(float(i), float(j)) * px;
                    vec3 c0 = texture2D(tDiffuse, vUv + vec2(-d.x, -d.y)).rgb;
                    vec3 c1 = texture2D(tDiffuse, vUv + vec2(d.x, -d.y)).rgb;
                    vec3 c2 = texture2D(tDiffuse, vUv + vec2(-d.x, d.y)).rgb;
                    vec3 c3 = texture2D(tDiffuse, vUv + vec2(d.x, d.y)).rgb;
                    sum[0] += c0; sumSq[0] += c0 * c0;
                    sum[1] += c1; sumSq[1] += c1 * c1;
                    sum[2] += c2; sumSq[2] += c2 * c2;
                    sum[3] += c3; sumSq[3] += c3 * c3;
                }
            }

            vec3 m0 = sum[0] / count; vec3 v0 = sumSq[0] / count - m0 * m0;
            vec3 m1 = sum[1] / count; vec3 v1 = sumSq[1] / count - m1 * m1;
            vec3 m2 = sum[2] / count; vec3 v2 = sumSq[2] / count - m2 * m2;
            vec3 m3 = sum[3] / count; vec3 v3 = sumSq[3] / count - m3 * m3;

            float s0 = v0.r + v0.g + v0.b;
            float s1 = v1.r + v1.g + v1.b;
            float s2 = v2.r + v2.g + v2.b;
            float s3 = v3.r + v3.g + v3.b;

            vec3 result = m0;
            float minVar = s0;
            if (s1 < minVar) { minVar = s1; result = m1; }
            if (s2 < minVar) { minVar = s2; result = m2; }
            if (s3 < minVar) { minVar = s3; result = m3; }

            gl_FragColor = vec4(result, 1.0);
        }
    `
};

/** Per-channel posterization to `levels` steps — a reduced palette. */
export const POSTERIZE_SHADER: ShaderDef = {
    name: 'PosterizeShader',
    uniforms: {
        tDiffuse: { value: null },
        levels: { value: 6 }
    },
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float levels;
        varying vec2 vUv;

        void main() {
            vec3 c = texture2D(tDiffuse, vUv).rgb;
            float l = max(levels, 2.0);
            vec3 q = floor(c * (l - 1.0) + 0.5) / (l - 1.0);
            gl_FragColor = vec4(clamp(q, 0.0, 1.0), 1.0);
        }
    `
};

/**
 * Bayer ordered dithering with quantization. Uses the recursive bit-interleave
 * Bayer-matrix hash so no array lookups are needed (WebGL1 friendly).
 */
export const DITHER_SHADER: ShaderDef = {
    name: 'DitherShader',
    uniforms: {
        tDiffuse: { value: null },
        levels: { value: 4 }
    },
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float levels;
        varying vec2 vUv;

        float bayer2(vec2 a) {
            a = floor(a);
            return fract(a.x / 2.0 + a.y * a.y * 0.75);
        }
        float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
        float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

        void main() {
            vec3 c = texture2D(tDiffuse, vUv).rgb;
            float l = max(levels, 2.0);
            float threshold = bayer8(gl_FragCoord.xy) - 0.5;
            vec3 dithered = c + threshold / l;
            vec3 q = floor(dithered * (l - 1.0) + 0.5) / (l - 1.0);
            gl_FragColor = vec4(clamp(q, 0.0, 1.0), 1.0);
        }
    `
};

/** Cheap Sobel-luminance edge darkening for a cel/toon outline. */
export const TOON_OUTLINE_SHADER: ShaderDef = {
    name: 'ToonOutlineShader',
    uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) },
        strength: { value: 0.8 }
    },
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float strength;
        varying vec2 vUv;

        float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

        void main() {
            vec2 px = 1.0 / resolution;
            float tl = lum(texture2D(tDiffuse, vUv + px * vec2(-1.0, -1.0)).rgb);
            float t  = lum(texture2D(tDiffuse, vUv + px * vec2(0.0, -1.0)).rgb);
            float tr = lum(texture2D(tDiffuse, vUv + px * vec2(1.0, -1.0)).rgb);
            float l  = lum(texture2D(tDiffuse, vUv + px * vec2(-1.0, 0.0)).rgb);
            float r  = lum(texture2D(tDiffuse, vUv + px * vec2(1.0, 0.0)).rgb);
            float bl = lum(texture2D(tDiffuse, vUv + px * vec2(-1.0, 1.0)).rgb);
            float b  = lum(texture2D(tDiffuse, vUv + px * vec2(0.0, 1.0)).rgb);
            float br = lum(texture2D(tDiffuse, vUv + px * vec2(1.0, 1.0)).rgb);

            float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
            float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
            float g = sqrt(gx * gx + gy * gy);
            float edge = smoothstep(0.25, 0.7, g) * strength;

            vec3 c = texture2D(tDiffuse, vUv).rgb;
            gl_FragColor = vec4(mix(c, vec3(0.04, 0.05, 0.07), edge), 1.0);
        }
    `
};
