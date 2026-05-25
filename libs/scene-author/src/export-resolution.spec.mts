import type { Voxel } from '@cbnsndwch/world-core';
import { beforeEach, describe, expect, it } from 'vitest';

import { setCatalog } from './catalog.mjs';
import {
    bakeSceneVox,
    composeSceneVoxels,
    sceneBakeResolution,
    type VoxelSource
} from './export-vox.mjs';
import { PlacementSystem } from './placement-system.mjs';
import { TileMap } from './tile-map.mjs';

/** A VoxelSource backed by an in-memory map of id → voxels + dims. */
function source(
    entries: Record<string, { voxels: Voxel[]; dims: [number, number, number] }>
): VoxelSource {
    return {
        get: id => entries[id]?.voxels ?? [],
        dims: id => entries[id]?.dims ?? [0, 0, 0]
    };
}

const W = '#ffffff';
const R = '#ff0000';

beforeEach(() => {
    setCatalog([
        {
            id: 'grass',
            name: 'grass',
            category: 'terrain',
            file: '/voxels/terrain/grass.vox',
            stackable: true
        },
        {
            // A finer (r=24) single-cell terrain tile — same world cell, 2× voxels.
            id: 'fine',
            name: 'fine',
            category: 'terrain',
            file: '/voxels/terrain/fine.vox',
            stackable: true,
            resolution: 24
        },
        {
            // Highest allowed resolution, for the per-scene 256-axis guard.
            id: 'slab48',
            name: 'slab',
            category: 'terrain',
            file: '/voxels/terrain/slab48.vox',
            stackable: true,
            resolution: 48
        }
    ]);
});

describe('sceneBakeResolution', () => {
    it('is 12 for a legacy all-r=12 scene', () => {
        const map = new TileMap(2, 2);
        new PlacementSystem(map).place('grass', 0, 0, 0);
        expect(sceneBakeResolution(map)).toBe(12);
    });

    it('is the LCM (= max for the 12/24 divisor chain) of present resolutions', () => {
        const map = new TileMap(2, 1);
        const sys = new PlacementSystem(map);
        sys.place('grass', 1, 0, 0);
        sys.place('fine', 0, 0, 0);
        expect(sceneBakeResolution(map)).toBe(24);
    });
});

describe('composeSceneVoxels — regression (all r=12)', () => {
    it('bakes a 12-res terrain + building scene with no upscaling', () => {
        const map = new TileMap(4, 4);
        const sys = new PlacementSystem(map, () => 1);
        sys.place('grass', 1, 2, 0);

        const voxels = composeSceneVoxels(
            map,
            source({ grass: { voxels: [{ x: 3, y: 4, z: 5, c: W }], dims: [12, 12, 6] } })
        );

        // s = R/r = 12/12 = 1 → exactly one output voxel (no upscale block).
        expect(voxels).toHaveLength(1);
        // Legacy formula: x = gx*12 + vx, y = gy*12 + vy, then min-corner shift.
        // Single voxel → normalized to the origin.
        expect(voxels[0]).toEqual({ x: 0, y: 0, z: 0, c: W });
    });

    it('keeps total voxel count equal to source count when all r=12', () => {
        const map = new TileMap(3, 3);
        const sys = new PlacementSystem(map, () => 1);
        sys.place('grass', 0, 0, 0);
        sys.place('grass', 2, 1, 0);
        const g = { voxels: [{ x: 0, y: 0, z: 0, c: W }, { x: 11, y: 11, z: 0, c: W }], dims: [12, 12, 1] as [number, number, number] };
        const voxels = composeSceneVoxels(map, source({ grass: g }));
        expect(voxels).toHaveLength(4); // 2 cells × 2 voxels, no upscaling
    });
});

describe('composeSceneVoxels — mixed resolution', () => {
    it('upscales a coarser (r=12) tile onto the common r=24 grid', () => {
        const map = new TileMap(2, 1);
        const sys = new PlacementSystem(map, () => 1);
        sys.place('grass', 1, 0, 0); // r=12 → upscaled ×2
        sys.place('fine', 0, 0, 0); // r=24 → 1:1

        const voxels = composeSceneVoxels(
            map,
            source({
                grass: { voxels: [{ x: 0, y: 0, z: 0, c: W }], dims: [12, 12, 1] },
                fine: { voxels: [{ x: 0, y: 0, z: 0, c: R }], dims: [24, 24, 1] }
            })
        );

        // grass: 1 voxel → 2³ = 8-voxel block; fine: 1 voxel → 1. Total 9.
        expect(voxels).toHaveLength(9);
        expect(voxels.filter(v => v.c === R)).toHaveLength(1);
        expect(voxels.filter(v => v.c === W)).toHaveLength(8);

        // fine sits at the grid origin (column 0); grass fills a 2×2×2 block at
        // grid x 24..25 (column 1 of the R=24 grid).
        expect(voxels.find(v => v.c === R)).toEqual({ x: 0, y: 0, z: 0, c: R });
        const gx = voxels.filter(v => v.c === W).map(v => v.x).sort((a, b) => a - b);
        expect(gx).toEqual([24, 24, 24, 24, 25, 25, 25, 25]);
    });

    it('stacks a high-res cell on a low-res riser at the right world height', () => {
        const map = new TileMap(1, 1);
        // Real world-height resolver: dims.z × (P/r) = world units.
        const dims: Record<string, [number, number, number]> = {
            grass: [12, 12, 3], // 3 voxels @ r12 = 3 world units tall
            fine: [24, 24, 1]
        };
        const heightOf = (id: string): number =>
            dims[id]![2] * (12 / (id === 'fine' ? 24 : 12));
        const sys = new PlacementSystem(map, heightOf);
        sys.place('grass', 0, 0, 0);
        sys.place('fine', 0, 0, 0); // stacks on top of the 3-tall grass riser

        const voxels = composeSceneVoxels(
            map,
            source({
                grass: {
                    // 3 stacked layers, matching dims.z = 3.
                    voxels: [
                        { x: 0, y: 0, z: 0, c: W },
                        { x: 0, y: 0, z: 1, c: W },
                        { x: 0, y: 0, z: 2, c: W }
                    ],
                    dims: dims.grass!
                },
                fine: { voxels: [{ x: 0, y: 0, z: 0, c: R }], dims: dims.fine! }
            })
        );

        // R=24. grass (r=12) upscales ×2: its 3 layers fill grid z 0..5. fine
        // rests at world height 3 → grid z = 3 × 24/12 = 6. Its r=24 voxel lands
        // at grid z 6 — flush on top of the riser, no gap or overlap.
        const red = voxels.find(v => v.c === R)!;
        expect(red.z).toBe(6);
        // No gap/overlap: the riser's top grid layer is 5, fine starts at 6.
        const maxWhiteZ = Math.max(...voxels.filter(v => v.c === W).map(v => v.z));
        expect(maxWhiteZ).toBe(5);
    });
});

describe('bakeSceneVox — 256-axis guard', () => {
    it('throws a clear error when the common grid overflows 256 voxels/axis', () => {
        const map = new TileMap(6, 1);
        const sys = new PlacementSystem(map, () => 1);
        sys.place('slab48', 0, 0, 0);
        sys.place('slab48', 5, 0, 0); // 6 columns × 48 = 288 > 256

        const src = source({
            slab48: {
                // a voxel at each cell's near + far edge so the span is the full grid
                voxels: [
                    { x: 0, y: 0, z: 0, c: W },
                    { x: 47, y: 0, z: 0, c: W }
                ],
                dims: [48, 48, 1]
            }
        });
        expect(() => bakeSceneVox(map, src)).toThrow(/256/);
    });

    it('bakes a within-cap mixed-resolution scene round-trip', () => {
        const map = new TileMap(2, 1);
        const sys = new PlacementSystem(map, () => 1);
        sys.place('grass', 0, 0, 0);
        sys.place('fine', 1, 0, 0);
        const buf = bakeSceneVox(
            map,
            source({
                grass: { voxels: [{ x: 0, y: 0, z: 0, c: W }], dims: [12, 12, 1] },
                fine: { voxels: [{ x: 0, y: 0, z: 0, c: R }], dims: [24, 24, 1] }
            })
        );
        expect(buf).not.toBeNull();
        expect(buf!.byteLength).toBeGreaterThan(0);
    });
});
