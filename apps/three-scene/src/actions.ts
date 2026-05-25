import { toast } from 'sonner';

import { getEngine } from './bootstrap.js';
import {
    addTile,
    assetsForCategory,
    removeTile,
    TERRAIN_MANIFEST
} from '@cbnsndwch/scene-author';
import { deleteTile, saveTile, type TileMeta } from './core/tile-save.js';
import { renderThumbnail } from './ui/thumbnails.js';
import { emit } from './store.js';

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
