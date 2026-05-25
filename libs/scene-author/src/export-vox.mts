import { encodeVox, type Voxel } from '@cbnsndwch/world-core';

import { ASSET_INDEX } from './catalog.mjs';
import { VOXEL_PER_TILE } from './constants.mjs';
import type { Rotation, TileMap } from './tile-map.mjs';

const SPAN = VOXEL_PER_TILE;

/**
 * Supplies the decoded voxel data for a tile id. The browser editor's
 * `VoxelAssets` (fetch + decode of `public/voxels/*.vox`) and the headless
 * server's filesystem loader both satisfy this, so `.vox` composition is shared.
 */
export interface VoxelSource {
    /** Decoded voxels for an id (empty list if not loaded). */
    get(id: string): Voxel[];
    /** `[x, y, z]` dimensions from the cell's SIZE chunk. */
    dims(id: string): readonly [number, number, number];
}

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
    source: VoxelSource
): Voxel[] {
    const out: Voxel[] = [];
    tileMap.forEachColumn((gx, gy, stack) => {
        let base = 0;
        for (const cell of stack) {
            // Nature and props tiles are ground-anchored: they render at the
            // column base (z=0) so their geometry clips into the terrain rather
            // than floating above it. Only terrain and buildings advance base.
            const cat = ASSET_INDEX[cell.id]?.category ?? 'terrain';
            const groundAnchored = cat === 'nature' || cat === 'props';
            const zBase = groundAnchored ? 0 : base;
            for (const v of source.get(cell.id)) {
                const [rx, ry] = rotateXY(v.x, v.y, cell.rot);
                out.push({
                    x: gx * SPAN + rx,
                    y: gy * SPAN + ry,
                    z: zBase + v.z,
                    c: v.c
                });
            }
            if (!groundAnchored) {
                base += source.dims(cell.id)[2];
            }
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
 * Compose + encode the scene to a MagicaVoxel `.vox` buffer, reusing the same
 * `encodeVox` the editor uses. Returns `null` when the scene is empty (nothing
 * to bake). The browser download wrapper and the server's persistence both build
 * on this.
 */
export function bakeSceneVox(
    tileMap: TileMap,
    source: VoxelSource
): ArrayBuffer | null {
    const voxels = composeSceneVoxels(tileMap, source);
    if (voxels.length === 0) return null;
    return encodeVox(voxels);
}
