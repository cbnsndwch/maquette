import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { PostFx, WorldSpec } from '@cbnsndwch/contracts';
import { musicologiaTrackSchema } from '@cbnsndwch/contracts';
import {
    buildScene,
    createPostFx,
    hasPostFx,
    suggestCameraPosition
} from '@cbnsndwch/world-core';
import {
    generateLlmWorld,
    generateWfcWorld,
    selectBiome,
    trackToWorldInputs,
    MusicBrainzClient,
    MusicologiaTrackSource,
    type GenerateWfcOptions,
    type TrackAffinities
} from '@cbnsndwch/world-gen';

const container = document.getElementById('app')!;
const seedEl = document.getElementById('seed');

// Seed comes from a Spotify-style track id; allow overriding via ?seed=...
// Switch generation via ?paradigm=wfc|llm (llm uses the offline fake client
// unless an API key is wired in), and force the Stage 4 aesthetic pass via
// ?postfx=all (or a comma list: kuwahara,quantize,dither,toon).
const params = new URLSearchParams(window.location.search);
const seed = params.get('seed') ?? 'spotify:track:musicologia-demo';
const paradigm = params.get('paradigm') === 'llm' ? 'llm' : 'wfc';

// ?biome= explicitly overrides automatic biome selection.
const biomeOverride = params.get('biome') ?? undefined;

// Talks to the live Musicologia API + MusicBrainz through the Vite dev proxy
// (vite.config.ts), which injects the admin key and the MB User-Agent so
// neither has to live in the browser bundle. Relative base => proxy paths.
const source = new MusicologiaTrackSource({
    baseUrl: '',
    apiKey: '', // injected by the dev proxy
    musicBrainz: new MusicBrainzClient({ baseUrl: '/mb' })
});

// Spotify URIs look like spotify:track:<id>; plain seeds are used as-is.
const trackId = seed.startsWith('spotify:track:')
    ? seed.slice('spotify:track:'.length)
    : seed;

/**
 * Resolve the generator inputs (biome + audio features) for the current seed:
 *   1. ?biome= wins outright.
 *   2. Live Musicologia API (proxied), genres/origin enriched via MusicBrainz.
 *   3. Offline fallback to a hand-authored /tracks/<id>.json demo fixture.
 * Returns {} (seed-derived features + default biome) when nothing matches.
 */
async function resolveWorldInputs(): Promise<GenerateWfcOptions> {
    if (biomeOverride !== undefined) {
        return { biomeId: biomeOverride };
    }

    // 1. Live catalog track (real Spotify id).
    const live = await source.getWorldInputs(trackId);
    if (live.biomeId !== undefined) {
        return live;
    }

    // 2. Offline demo fixture.
    return resolveFromLocalJson();
}

/**
 * Load a demo track from /tracks/<id>.json. These fixtures carry genres/tags/
 * origin as extra keys (which Zod strips), so they're read off the raw JSON
 * before validation, then fed to selectBiome().
 */
async function resolveFromLocalJson(): Promise<GenerateWfcOptions> {
    let raw: unknown;
    try {
        const res = await fetch(`/tracks/${encodeURIComponent(trackId)}.json`);
        if (!res.ok) return {};
        raw = await res.json();
    } catch {
        return {};
    }

    const rawObj = raw as Record<string, unknown>;
    const genres = Array.isArray(rawObj['genres'])
        ? (rawObj['genres'] as string[])
        : undefined;
    const tags = Array.isArray(rawObj['tags'])
        ? (rawObj['tags'] as string[])
        : undefined;
    const origin =
        typeof rawObj['origin'] === 'string' ? rawObj['origin'] : undefined;

    const parsed = musicologiaTrackSchema.safeParse(raw);
    if (!parsed.success) return {};
    const track = parsed.data;

    const affinities: TrackAffinities = {
        genres,
        tags,
        origin,
        energy: track.energy,
        valence: track.valence,
        tempo: track.tempo,
        danceability: Math.max(
            0,
            Math.min(1, track.energy * 0.5 + (track.mode === 1 ? 0.3 : 0.1))
        )
    };

    return { ...trackToWorldInputs(track), biomeId: selectBiome(affinities) };
}

function postFxOverride(): PostFx | null {
    const raw = params.get('postfx');
    if (!raw) {
        return null;
    }
    const set = new Set(raw.split(','));
    const all = raw === '1' || set.has('all');
    return {
        kuwahara: all || set.has('kuwahara'),
        dither: all || set.has('dither'),
        paletteQuantize: all || set.has('quantize') ? 6 : 0,
        toonOutline: all || set.has('toon')
    };
}

async function generate(): Promise<WorldSpec> {
    if (paradigm === 'llm') {
        return generateLlmWorld(seed);
    }
    return generateWfcWorld(seed, await resolveWorldInputs());
}

async function main() {
    const spec = await generate();
    const override = postFxOverride();
    if (override) {
        spec.postFx = override;
    }
    if (seedEl) {
        seedEl.textContent = `seed: ${seed} · ${spec.paradigm} · ${spec.timeOfDay} · ${spec.weather}`;
    }

    const scene = buildScene(spec);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(
        45,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );
    const cam = suggestCameraPosition();
    camera.position.set(...cam.position);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...cam.target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;
    controls.update();

    const chain = hasPostFx(spec.postFx)
        ? createPostFx(renderer, scene, camera, spec, { pixelRatio })
        : null;

    function onResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        chain?.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener('resize', onResize);

    function animate() {
        controls.update();
        if (chain) {
            chain.render();
        } else {
            renderer.render(scene, camera);
        }
        requestAnimationFrame(animate);
    }
    animate();
}

void main();
