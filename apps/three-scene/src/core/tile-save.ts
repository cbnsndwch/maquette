import { encodeVox, type Voxel } from '@cbnsndwch/world-core';

import type { Category, TerrainDef } from '@cbnsndwch/scene-author';

export interface TileMeta {
    id: string;
    name: string;
    category: Category;
    stackable: boolean;
}

/** Base64-encode an ArrayBuffer in chunks (avoids arg-count limits on large files). */
function toBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

/**
 * Encode the authored voxels to `.vox` and POST them to the dev-server tiles
 * controller, which writes the file to disk and upserts the catalog. Returns the
 * saved tile def, or null on failure.
 */
export async function saveTile(
    meta: TileMeta,
    voxels: Voxel[],
    palette?: readonly (string | null)[]
): Promise<TerrainDef | null> {
    try {
        const voxBase64 = toBase64(encodeVox(voxels, undefined, palette));
        const res = await fetch('/api/tiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...meta, voxBase64 })
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { tile?: TerrainDef };
        return data.tile ?? null;
    } catch (err) {
        // oxlint-disable-next-line no-console
        console.error('Failed to save tile:', err);
        return null;
    }
}

/**
 * Soft-delete a tile on the server (flags the catalog entry; the `.vox` file is
 * kept). Returns true on success.
 */
export async function deleteTile(id: string): Promise<boolean> {
    try {
        const res = await fetch(`/api/tiles/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
        return res.ok;
    } catch {
        return false;
    }
}
