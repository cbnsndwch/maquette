import { encodeVox, rotateFootprintXY, type Voxel } from '@cbnsndwch/world-core';

import { footprintOf, isGroundAnchored, resolutionOf } from './catalog.mjs';
import { VOXEL_PER_TILE, WORLD_CELL } from './constants.mjs';
import type { TileMap } from './tile-map.mjs';

/** The MagicaVoxel grid is capped at 256 voxels per axis. */
const MAX_AXIS = 256;

function gcd(a: number, b: number): number {
    while (b !== 0) [a, b] = [b, a % b];
    return a;
}

function lcm(a: number, b: number): number {
    return (a / gcd(a, b)) * b;
}

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

/** Every distinct tile id placed in the scene (terrain stacks + buildings). */
function placedIds(tileMap: TileMap): Set<string> {
    const ids = new Set<string>();
    tileMap.forEachColumn((_gx, _gy, stack) => {
        for (const c of stack) ids.add(c.id);
    });
    for (const b of tileMap.getBuildings()) ids.add(b.id);
    return ids;
}

/**
 * The common voxel grid the scene bakes onto: the LCM of every placed tile's
 * resolution. For the allowed 12/24/36/48 divisor chain this equals the maximum
 * resolution present (PRD R1, "bake at max-r"); the LCM form also stays correct
 * for any non-divisor mix. A legacy all-`r=12` scene yields 12 (unchanged grid).
 */
export function sceneBakeResolution(tileMap: TileMap): number {
    let r = VOXEL_PER_TILE;
    for (const id of placedIds(tileMap)) r = lcm(r, resolutionOf(id));
    return r;
}

/**
 * Compose every placed cell into one voxel list in global grid coordinates,
 * baking in each cell's rotation, then normalize so the model's lowest corner
 * sits at the origin (a tight, centered `.vox`).
 *
 * Mixed resolutions bake onto a **common grid** at {@link sceneBakeResolution}
 * `R`: a tile of resolution `r` is nearest-neighbour upscaled by `s = R/r`
 * (each authored voxel becomes an `s³` block), so finer assets keep their detail
 * and coarser ones tile exactly. Column/altitude math is in world units, then
 * converted to `R`-grid layers, so cells of different `r` stack consistently
 * (PRD §5.1). An all-`r=12` scene (`R = 12`, `s = 1`) is bit-identical to the
 * pre-resolution bake.
 *
 * Single-cell terrain stacks emit per column; multi-cell buildings emit **once**
 * at their anchor (spanning `w·r × d·r` authored voxels), never double-drawn
 * against their occupied cells.
 */
export function composeSceneVoxels(
    tileMap: TileMap,
    source: VoxelSource
): Voxel[] {
    const R = sceneBakeResolution(tileMap);
    const out: Voxel[] = [];

    // World altitude → R-grid voxel layers (one R-voxel = WORLD_CELL/R units).
    const toGridZ = (worldY: number): number =>
        Math.round((worldY * R) / WORLD_CELL);

    // Emit one authored voxel as its s³ upscale block on the R grid.
    const emitBlock = (
        gridX: number,
        gridY: number,
        gridZ: number,
        s: number,
        c: string
    ): void => {
        for (let dz = 0; dz < s; dz++) {
            for (let dy = 0; dy < s; dy++) {
                for (let dx = 0; dx < s; dx++) {
                    out.push({
                        x: gridX + dx,
                        y: gridY + dy,
                        z: gridZ + dz,
                        c
                    });
                }
            }
        }
    };

    tileMap.forEachColumn((gx, gy, stack) => {
        let base = 0; // world altitude
        for (const cell of stack) {
            const r = resolutionOf(cell.id);
            const s = R / r;
            // Nature and props tiles are ground-anchored: they render at the
            // column base (z=0) so their geometry clips into the terrain rather
            // than floating above it. Only terrain and buildings advance base.
            const groundAnchored = isGroundAnchored(cell.id);
            const zBaseGrid = toGridZ(groundAnchored ? 0 : base);
            for (const v of source.get(cell.id)) {
                // Square footprint: spanX === spanY === r (bit-identical to the
                // previous single-span rotation when r = 12).
                const [rx, ry] = rotateFootprintXY(v.x, v.y, cell.rot, r, r);
                emitBlock(
                    gx * R + rx * s,
                    gy * R + ry * s,
                    zBaseGrid + v.z * s,
                    s,
                    v.c
                );
            }
            if (!groundAnchored) {
                base += source.dims(cell.id)[2] * (WORLD_CELL / r);
            }
        }
    });
    for (const b of tileMap.getBuildings()) {
        const r = resolutionOf(b.id);
        const s = R / r;
        const [fw, fd] = footprintOf(b.id);
        const spanX = fw * r;
        const spanY = fd * r;
        const zBaseGrid = toGridZ(b.baseLevel);
        for (const v of source.get(b.id)) {
            const [rx, ry] = rotateFootprintXY(v.x, v.y, b.rot, spanX, spanY);
            emitBlock(
                b.ax * R + rx * s,
                b.ay * R + ry * s,
                zBaseGrid + v.z * s,
                s,
                v.c
            );
        }
    }
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
 *
 * Throws a descriptive error when the common-grid bake exceeds the 256-voxel
 * axis cap (`gridCells × R > 256`, e.g. a full island with high-resolution
 * tiles) — export a smaller region or lower the resolution (PRD §5.3).
 */
export function bakeSceneVox(
    tileMap: TileMap,
    source: VoxelSource
): ArrayBuffer | null {
    const voxels = composeSceneVoxels(tileMap, source);
    if (voxels.length === 0) return null;

    let mx = 0;
    let my = 0;
    let mz = 0;
    for (const v of voxels) {
        if (v.x > mx) mx = v.x;
        if (v.y > my) my = v.y;
        if (v.z > mz) mz = v.z;
    }
    if (mx >= MAX_AXIS || my >= MAX_AXIS || mz >= MAX_AXIS) {
        const R = sceneBakeResolution(tileMap);
        throw new Error(
            `scene exceeds the ${MAX_AXIS}-voxel axis cap at resolution R=${R} ` +
                `(extent ${mx + 1}×${my + 1}×${mz + 1}). Export a smaller region ` +
                `or lower the tile resolution.`
        );
    }
    return encodeVox(voxels);
}
