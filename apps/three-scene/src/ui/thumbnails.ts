import * as THREE from 'three';

import { VoxelBatch } from '@cbnsndwch/world-core';

import { TERRAIN_MANIFEST } from '../config.js';
import type { VoxelAssets } from '../core/voxel-assets.js';

const SIZE = 128;

/**
 * Render a small isometric thumbnail of every terrain cell once, off-screen, so
 * the palette swatches show exactly what will be placed (the 3D analogue of the
 * reference palette's generated bitmaps). Returns id → PNG data URL.
 */
export function renderThumbnails(assets: VoxelAssets): Map<string, string> {
    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
    });
    renderer.setSize(SIZE, SIZE);
    renderer.setClearColor(0x000000, 0);

    const out = new Map<string, string>();
    for (const def of TERRAIN_MANIFEST) {
        const voxels = assets.get(def.id);
        if (!voxels.length) continue;

        const [, , h] = assets.dims(def.id);
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
        out.set(def.id, renderer.domElement.toDataURL('image/png'));

        group.traverse(o => {
            const m = o as Partial<THREE.Mesh>;
            m.geometry?.dispose();
            const mat = m.material;
            if (Array.isArray(mat)) mat.forEach(x => x.dispose());
            else mat?.dispose();
        });
    }

    renderer.dispose();
    return out;
}
