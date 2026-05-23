import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { PostFx, WorldSpec } from '@cbnsndwch/contracts';
import {
    buildScene,
    createPostFx,
    hasPostFx,
    suggestCameraPosition
} from '@cbnsndwch/world-core';
import { generateLlmWorld, generateWfcWorld } from '@cbnsndwch/world-gen';

const container = document.getElementById('app')!;
const seedEl = document.getElementById('seed');

// Seed comes from a Spotify-style track id; allow overriding via ?seed=...
// Switch generation via ?paradigm=wfc|llm (llm uses the offline fake client
// unless an API key is wired in), and force the Stage 4 aesthetic pass via
// ?postfx=all (or a comma list: kuwahara,quantize,dither,toon).
const params = new URLSearchParams(window.location.search);
const seed = params.get('seed') ?? 'spotify:track:musicologia-demo';
const paradigm = params.get('paradigm') === 'llm' ? 'llm' : 'wfc';
const biomeId = params.get('biome') ?? undefined;

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
    return paradigm === 'llm'
        ? generateLlmWorld(seed)
        : generateWfcWorld(seed, { biomeId });
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
