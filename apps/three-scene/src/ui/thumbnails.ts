import * as THREE from 'three';

import { VoxelBatch } from '@cbnsndwch/world-core';

import { TERRAIN_MANIFEST } from '../config.js';
import type { VoxelAssets } from '../core/voxel-assets.js';

const SIZE = 128;

function makeRenderer(): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
    });
    renderer.setSize(SIZE, SIZE);
    renderer.setClearColor(0x000000, 0);
    return renderer;
}

/** 
 * Render one tile to an isometric PNG data URL (null if it has no voxels). 
 */
function renderInto(
    renderer: THREE.WebGLRenderer,
    assets: VoxelAssets,
    id: string
): string | null {
    const voxels = assets.get(id);
    if (!voxels.length) return null;

    const [, , h] = assets.dims(id);
    const scene = new THREE.Scene();
    const batch = new VoxelBatch(1);
    batch.add(voxels, { origin: [0, 0, 0] });
    const group = batch.build();
    scene.add(group);

    const center = new THREE.Vector3(6, h / 2, 6);
    const radius = 0.5 * Math.hypot(12, 12, h);
    const half = radius * 1.05;
    const camera = new THREE.OrthographicCamera(
        -half,
        half,
        half,
        -half,
        0.1,
        1000
    );
    const dir = new THREE.Vector3(1, 0.95, 1).normalize();
    camera.position.copy(center).addScaledVector(dir, radius * 4);
    camera.lookAt(center);

    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');

    group.traverse(o => {
        const m = o as Partial<THREE.Mesh>;
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach(x => x.dispose());
        else mat?.dispose();
    });
    return url;
}

/**
 * Render a small isometric thumbnail of every catalog tile once, off-screen, so
 * palette swatches show exactly what will be placed. Returns id → PNG data URL.
 */
export function renderThumbnails(assets: VoxelAssets): Map<string, string> {
    const renderer = makeRenderer();
    const out = new Map<string, string>();
    for (const def of TERRAIN_MANIFEST) {
        const url = renderInto(renderer, assets, def.id);
        if (url) out.set(def.id, url);
    }
    renderer.dispose();
    return out;
}

/** 
 * Render a single tile's thumbnail (used after authoring a new tile). 
 */
export function renderThumbnail(
    assets: VoxelAssets,
    id: string
): string | null {
    const renderer = makeRenderer();
    const url = renderInto(renderer, assets, id);
    renderer.dispose();
    return url;
}
