import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    setCatalog,
    TERRAIN_MANIFEST,
    type TerrainDef,
    type VoxelSource
} from '@cbnsndwch/scene-author';
import { decodeVox, type Voxel } from '@cbnsndwch/world-core';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Root of the editor's public assets. The tile catalog (`voxels/catalog.json`)
 * and the baked `.vox` cells live under here. Defaults to the `three-scene`
 * app's `public/` dir (one sibling over), overridable for other deployments.
 */
export const PUBLIC_DIR =
    process.env.MAQUETTE_PUBLIC_DIR ??
    path.resolve(here, '../../three-scene/public');

function toArrayBuffer(buf: Buffer): ArrayBuffer {
    return buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength
    ) as ArrayBuffer;
}

/**
 * Read `catalog.json` from disk and publish the live tiles into the shared
 * catalog singleton (so {@link PlacementSystem} and the tools see them).
 * Returns the live tile defs (soft-deleted entries excluded by `setCatalog`).
 */
export async function loadCatalogFromDisk(
    publicDir: string = PUBLIC_DIR
): Promise<TerrainDef[]> {
    const catalogPath = path.join(publicDir, 'voxels', 'catalog.json');
    const raw = await readFile(catalogPath, 'utf8');
    const parsed = JSON.parse(raw) as { tiles?: TerrainDef[] };
    setCatalog(parsed.tiles ?? []);
    return [...TERRAIN_MANIFEST];
}

/**
 * A short, stable fingerprint of the catalog so a finalized scene can pin the
 * exact tile set it was authored against (PRD §7 catalog snapshot + version).
 */
export function computeCatalogVersion(tiles: readonly TerrainDef[]): string {
    const canonical = tiles
        .map(t => `${t.id}:${t.category}:${t.stackable ? 1 : 0}:${t.file}`)
        .sort()
        .join('\n');
    return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

/**
 * Loads each tile's `.vox` from disk and serves the decoded voxels by id,
 * implementing the same {@link VoxelSource} the browser editor's `VoxelAssets`
 * does — so `composeSceneVoxels` bakes identically on the server.
 */
export class FsVoxelSource implements VoxelSource {
    readonly #assets = new Map<
        string,
        { voxels: Voxel[]; dims: [number, number, number] }
    >();

    constructor(private readonly publicDir: string = PUBLIC_DIR) {}

    /** Fetch + decode every tile's `.vox` in parallel (missing files skipped). */
    async preload(defs: readonly TerrainDef[]): Promise<void> {
        await Promise.all(
            defs.map(async def => {
                try {
                    const buf = await readFile(
                        path.join(this.publicDir, def.file)
                    );
                    const asset = decodeVox(toArrayBuffer(buf));
                    this.#assets.set(def.id, {
                        voxels: asset.voxels,
                        dims: asset.dims
                    });
                } catch {
                    // Missing/unreadable .vox: the tile stays placeable, it just
                    // contributes no voxels when the scene is baked.
                }
            })
        );
    }

    /** Fetch + decode a single tile (e.g. one just authored), cache by id. */
    async loadOne(def: TerrainDef): Promise<void> {
        const buf = await readFile(path.join(this.publicDir, def.file));
        const asset = decodeVox(toArrayBuffer(buf));
        this.#assets.set(def.id, { voxels: asset.voxels, dims: asset.dims });
    }

    /** Seed a tile's voxels directly (skips a disk round-trip after authoring). */
    set(id: string, voxels: Voxel[], dims: [number, number, number]): void {
        this.#assets.set(id, { voxels, dims });
    }

    get(id: string): Voxel[] {
        return this.#assets.get(id)?.voxels ?? [];
    }

    dims(id: string): readonly [number, number, number] {
        return this.#assets.get(id)?.dims ?? [0, 0, 0];
    }

    has(id: string): boolean {
        return this.#assets.has(id);
    }
}
