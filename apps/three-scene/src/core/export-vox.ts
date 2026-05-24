import { composeSceneVoxels, type TileMap } from '@cbnsndwch/scene-author';
import { encodeVox } from '@cbnsndwch/world-core';

import type { VoxelAssets } from './voxel-assets.js';

/**
 * Encode the current scene to a `.vox` file and trigger a browser download.
 * Composition lives in the shared `@cbnsndwch/scene-author` core; this wrapper
 * is the browser-only download shell. Returns the voxel count written (0 when
 * the scene is empty).
 */
export function downloadSceneVox(
    tileMap: TileMap,
    assets: VoxelAssets,
    filename = 'scene.vox'
): number {
    const voxels = composeSceneVoxels(tileMap, assets);
    if (voxels.length === 0) return 0;

    const blob = new Blob([encodeVox(voxels)], {
        type: 'application/octet-stream'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return voxels.length;
}
