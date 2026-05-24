import { encodeVox, type Voxel } from '@cbnsndwch/world-core';

import { CONFIG } from '../config.js';
import type { Rotation, TileMap } from '../grid/tile-map.js';
import type { VoxelAssets } from './voxel-assets.js';

const SPAN = CONFIG.voxel.perTile;

/** Rotate a cell-local (x, y) within the footprint — matches VoxelBatch. */
function rotateXY(x: number, y: number, rot: Rotation): [number, number] {
    switch (rot) {
        case 1:
            return [y, SPAN - 1 - x];
        case 2:
            return [SPAN - 1 - x, SPAN - 1 - y];
        case 3:
            return [SPAN - 1 - y, x];
        default:
            return [x, y];
    }
}

/**
 * Compose every placed cell into one voxel list in global grid coordinates,
 * baking in each cell's rotation, then normalize so the model's lowest corner
 * sits at the origin (a tight, centered `.vox`).
 */
export function composeSceneVoxels(
    tileMap: TileMap,
    assets: VoxelAssets
): Voxel[] {
    const out: Voxel[] = [];
    tileMap.forEachColumn((gx, gy, stack) => {
        let base = 0;
        for (const cell of stack) {
            for (const v of assets.get(cell.id)) {
                const [rx, ry] = rotateXY(v.x, v.y, cell.rot);
                out.push({
                    x: gx * SPAN + rx,
                    y: gy * SPAN + ry,
                    z: base + v.z,
                    c: v.c
                });
            }
            base += assets.dims(cell.id)[2];
        }
    });
    if (out.length === 0) return out;

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    for (const v of out) {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.z < minZ) minZ = v.z;
    }
    for (const v of out) {
        v.x -= minX;
        v.y -= minY;
        v.z -= minZ;
    }
    return out;
}

/**
 * Encode the current scene to a `.vox` file and trigger a browser download.
 * Returns the voxel count written (0 when the scene is empty).
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
