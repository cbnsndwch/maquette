/**
 * Builder configuration.
 *
 * The scene-shape constants (grid + voxel footprint) and the tile catalog model
 * now live in `@cbnsndwch/scene-author`, shared with the headless authoring
 * server. This module keeps only the editor-specific bits — camera, the
 * localStorage key, and the browser catalog loader — and composes `CONFIG` from
 * the shared constants so both sides agree on dimensions.
 */

import {
    DEFAULT_GRID,
    GROUND_LAYERS,
    setCatalog,
    VOXEL_PER_TILE,
    VOXEL_SIZE,
    type TerrainDef
} from '@cbnsndwch/scene-author';

export const CONFIG = {
    grid: DEFAULT_GRID,

    voxel: {
        /** Voxels per cell edge — the terrain cells are a fixed 12×12 footprint. */
        perTile: VOXEL_PER_TILE,
        /** World units per voxel cube. */
        size: VOXEL_SIZE
    },

    /**
     * Number of voxel layers that sit *below* the ground datum (y = 0). The
     * terrain cells are authored so their lowest 4 layers are buried; anything
     * above layer 4 (grass tufts, sea walls) rises above ground. This makes a
     * single shared datum across cells of different heights.
     */
    groundLayers: GROUND_LAYERS,

    camera: {
        fov: 45,
        near: 0.1,
        far: 4000
    },

    storageKey: 'mykonos-three-scene.save.v2'
} as const;

/**
 * Fetch the catalog from the dev server (`GET /api/tiles`), falling back to the
 * static `catalog.json`, then publish it into the shared catalog via
 * {@link setCatalog} so tiles authored in the editor show up too.
 */
export async function loadCatalog(): Promise<void> {
    for (const url of ['/api/tiles', '/voxels/catalog.json']) {
        try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const data = (await res.json()) as { tiles?: TerrainDef[] };
            setCatalog(data.tiles ?? []);
            return;
        } catch {
            // try the next source
        }
    }
}
