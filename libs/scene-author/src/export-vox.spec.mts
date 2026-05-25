import type { Voxel } from '@cbnsndwch/world-core';
import { beforeEach, describe, expect, it } from 'vitest';

import { setCatalog } from './catalog.mjs';
import { composeSceneVoxels, type VoxelSource } from './export-vox.mjs';
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
            // A 2×1 building marked by a single voxel at each authored corner,
            // so we can assert exactly where the corners land after rotation.
            id: 'bridge_2x1',
            name: 'bridge',
            category: 'buildings',
            file: '/voxels/terrain/bridge_2x1.vox',
            stackable: false,
            footprint: [2, 1]
        }
    ]);
});

const px = (n: number): Voxel => ({ x: n, y: 0, z: 0, c: '#ffffff' });

describe('composeSceneVoxels — buildings', () => {
    it('emits a building once at its anchor, spanning its footprint', () => {
        const map = new TileMap(6, 6);
        new PlacementSystem(map).place('bridge_2x1', 2, 3, 0);

        // Two voxels: x=0 and x=23 (the far edge of a 2-cell, 24-voxel span).
        const voxels = composeSceneVoxels(
            map,
            source({
                bridge_2x1: { voxels: [px(0), px(23)], dims: [24, 12, 1] }
            })
        );
        // Anchor (2,3) → x = 2*12 + rx, y = 3*12 + ry. After min-corner
        // normalization the lower corner sits at the origin, so the two voxels
        // are 23 apart in x and share y/z.
        expect(voxels).toHaveLength(2);
        const xs = voxels.map(v => v.x).sort((a, b) => a - b);
        expect(xs).toEqual([0, 23]);
        expect(voxels.every(v => v.y === voxels[0]!.y)).toBe(true);
    });

    it('rotates a building footprint (2×1 → 1×2) before emitting', () => {
        const map = new TileMap(6, 6);
        new PlacementSystem(map).place('bridge_2x1', 2, 3, 1);

        const voxels = composeSceneVoxels(
            map,
            source({
                bridge_2x1: { voxels: [px(0), px(23)], dims: [24, 12, 1] }
            })
        );
        // rot 1 maps the x-axis run onto the y (depth) axis: the two voxels now
        // differ in y, not x.
        expect(voxels).toHaveLength(2);
        const ys = voxels.map(v => v.y).sort((a, b) => a - b);
        expect(ys).toEqual([0, 23]);
        expect(voxels.every(v => v.x === voxels[0]!.x)).toBe(true);
    });

    it('does not double-emit a building against its occupied terrain cells', () => {
        const map = new TileMap(6, 6);
        const sys = new PlacementSystem(map);
        sys.place('grass', 0, 0, 0); // a plain terrain cell elsewhere
        sys.place('bridge_2x1', 2, 3, 0);

        const voxels = composeSceneVoxels(
            map,
            source({
                grass: { voxels: [px(0)], dims: [12, 12, 1] },
                bridge_2x1: { voxels: [px(0), px(23)], dims: [24, 12, 1] }
            })
        );
        // 1 grass + 2 bridge, emitted once each.
        expect(voxels).toHaveLength(3);
    });
});
