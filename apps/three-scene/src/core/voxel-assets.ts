import { loadVoxAsset, type VoxAsset, type Voxel } from '@cbnsndwch/world-core';

import { TERRAIN_MANIFEST } from '../config.js';

/**
 * Preloads and caches the decoded `.vox` terrain cells so the synchronous scene
 * rebuild can look up a cell's voxels by id. Each asset is a 12×12×H grid of
 * voxels with colors already baked from its MagicaVoxel palette.
 */
export class VoxelAssets {
    private readonly assets = new Map<string, VoxAsset>();

    /** Fetch + decode every terrain cell in parallel. */
    async preload(): Promise<void> {
        await Promise.all(
            TERRAIN_MANIFEST.map(async def => {
                this.assets.set(def.id, await loadVoxAsset(def.file));
            })
        );
    }

    /** Fetch + decode a single tile (cache-busted, for a just-saved file). */
    async loadOne(id: string, file: string): Promise<void> {
        this.assets.set(id, await loadVoxAsset(`${file}?t=${Date.now()}`));
    }

    has(id: string): boolean {
        return this.assets.has(id);
    }

    /** Decoded voxels for an id (empty list if not loaded). */
    get(id: string): Voxel[] {
        return this.assets.get(id)?.voxels ?? [];
    }

    /** `[x, y, z]` dimensions from the cell's SIZE chunk. */
    dims(id: string): [number, number, number] {
        return this.assets.get(id)?.dims ?? [0, 0, 0];
    }
}
