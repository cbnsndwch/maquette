import { toast } from 'sonner';

import { getEngine } from './bootstrap.js';
import {
    addTile,
    assetsForCategory,
    removeTile,
    TERRAIN_MANIFEST,
    type TerrainDef
} from '@cbnsndwch/scene-author';
import { loadCatalog } from './config.js';
import { deleteTile, saveTile, type TileMeta } from './core/tile-save.js';
import { renderThumbnail } from './ui/thumbnails.js';
import { emit } from './store.js';

/** Return `base` if unused in the catalog, otherwise `base_2`, `base_3`, … */
function uniqueId(base: string): string {
    if (!TERRAIN_MANIFEST.some(t => t.id === base)) return base;
    let n = 2;
    while (TERRAIN_MANIFEST.some(t => t.id === `${base}_${n}`)) n++;
    return `${base}_${n}`;
}

/**
 * Encode + persist the authored tile, refresh its cached asset + thumbnail,
 * select it in the palette, and re-point the editor at it so further saves
 * overwrite in place. Notifies React. Returns true on success.
 */
export async function saveTileFlow(meta: TileMeta): Promise<boolean> {
    const { game, editor, assets, thumbnails } = getEngine();
    if (editor.voxels.length === 0) {
        toast('Add some voxels first');
        return false;
    }

    const def = await saveTile(meta, editor.materialize(), editor.palette);
    if (!def) {
        toast('Save failed');
        return false;
    }

    addTile(def);

    await assets.loadOne(def.id, def.file);

    const thumb = renderThumbnail(assets, def.id);
    if (thumb) {
        thumbnails.set(def.id, thumb);
    }

    game.setCategory(def.category);
    game.selectAsset(def.id);

    // Stay in the editor — Save commits, Done leaves. Re-point at the saved tile
    // so further saves update it (no duplicate).
    editor.editingId = def.id;
    editor.recordSave();
    emit();
    toast(`Saved tile "${def.name}"`);

    return true;
}

/**
 * Duplicate a tile: save a copy under a new id, refresh the catalog + thumbnail,
 * and notify React. Returns true on success.
 */
export async function duplicateTileFlow(def: TerrainDef): Promise<boolean> {
    const { assets, thumbnails } = getEngine();
    const voxels = assets.get(def.id);
    const newName = `${def.name} copy`;
    const newId = uniqueId(`${def.id}_copy`);
    const meta: TileMeta = {
        id: newId,
        name: newName,
        category: def.category,
        stackable: def.stackable ?? true,
        footprint: def.footprint,
        resolution: def.resolution
    };
    const saved = await saveTile(meta, voxels);
    if (!saved) {
        toast('Duplicate failed');
        return false;
    }
    addTile(saved);
    await assets.loadOne(saved.id, saved.file);
    const thumb = renderThumbnail(assets, saved.id);
    if (thumb) thumbnails.set(saved.id, thumb);
    emit();
    toast(`Duplicated as "${saved.name}"`);
    return true;
}

/**
 * Re-fetch the catalog from disk, reload any new or changed tile assets
 * (cache-busted), re-render their thumbnails, and notify React. Use after
 * external edits (MagicaVoxel, MCP server) that bypassed the in-app save flow.
 */
export async function reloadCatalogFlow(): Promise<void> {
    const { assets, thumbnails } = getEngine();
    await loadCatalog();
    await Promise.all(
        TERRAIN_MANIFEST.map(def => assets.loadOne(def.id, def.file))
    );
    for (const def of TERRAIN_MANIFEST) {
        const thumb = renderThumbnail(assets, def.id);
        if (thumb) thumbnails.set(def.id, thumb);
    }
    emit();
    toast('Catalog reloaded');
}

/**
 * Soft-delete a tile (server + in-memory catalog), reselect a fallback asset if
 * the deleted one was active, and notify React. Returns true on success.
 */
export async function deleteTileFlow(id: string): Promise<boolean> {
    if (!(await deleteTile(id))) {
        toast('Delete failed');
        return false;
    }
    const { game } = getEngine();
    removeTile(id);
    if (game.selectedAssetId === id) {
        const next = assetsForCategory(game.category)[0] ?? TERRAIN_MANIFEST[0];
        if (next) game.selectAsset(next.id);
    }
    emit();
    toast('Tile deleted');
    return true;
}
