import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
    addTile,
    CATEGORIES,
    removeTile,
    type Category,
    type TerrainDef
} from '@cbnsndwch/scene-author';

/** Tile ids are filesystem-safe (they become `<id>.vox`). */
export const TILE_ID_RE = /^[a-z0-9_-]+$/i;

/** Derive a clean tile id from a display name (matches the editor's slug). */
export function slugifyTileId(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

interface Catalog {
    tiles: TerrainDef[];
}

async function readCatalog(catalogPath: string): Promise<Catalog> {
    try {
        const raw = await readFile(catalogPath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<Catalog>;
        return { tiles: parsed.tiles ?? [] };
    } catch {
        return { tiles: [] };
    }
}

export interface SaveTileInput {
    id: string;
    name: string;
    category: Category;
    stackable: boolean;
}

/**
 * Write the baked `.vox` and upsert the catalog entry on disk — byte-for-byte the
 * same layout the editor's `POST /api/tiles` produces (`public/voxels/terrain/<id>.vox`
 * + a 4-space-indented `catalog.json`) — then publish the tile into the live
 * in-memory catalog so it is immediately placeable. Returns the saved def.
 */
export async function saveTileToDisk(
    publicDir: string,
    input: SaveTileInput,
    vox: ArrayBuffer
): Promise<TerrainDef> {
    const voxelsDir = path.join(publicDir, 'voxels');
    const terrainDir = path.join(voxelsDir, 'terrain');
    const catalogPath = path.join(voxelsDir, 'catalog.json');

    const tile: TerrainDef = {
        id: input.id,
        name: input.name,
        category: CATEGORIES.includes(input.category)
            ? input.category
            : 'terrain',
        file: `/voxels/terrain/${input.id}.vox`,
        stackable: input.stackable
    };

    await mkdir(terrainDir, { recursive: true });
    await writeFile(path.join(terrainDir, `${input.id}.vox`), Buffer.from(vox));

    const catalog = await readCatalog(catalogPath);
    const i = catalog.tiles.findIndex(t => t.id === tile.id);
    if (i >= 0) catalog.tiles[i] = tile;
    else catalog.tiles.push(tile);
    await writeFile(catalogPath, `${JSON.stringify(catalog, null, 4)}\n`);

    addTile(tile);
    return tile;
}

/**
 * Soft-delete a tile: flag the catalog entry `deleted` (keeping the `.vox` on
 * disk, like the editor) and drop it from the live catalog. Returns false if no
 * such tile exists.
 */
export async function softDeleteTileOnDisk(
    publicDir: string,
    id: string
): Promise<boolean> {
    const catalogPath = path.join(publicDir, 'voxels', 'catalog.json');
    const catalog = await readCatalog(catalogPath);
    const tile = catalog.tiles.find(t => t.id === id);
    if (!tile) return false;
    tile.deleted = true;
    await writeFile(catalogPath, `${JSON.stringify(catalog, null, 4)}\n`);
    removeTile(id);
    return true;
}
