/**
 * Builder configuration.
 *
 * Mirrors the mykonos-voxels reference's `config.js`, but every dimension is
 * expressed in *voxels / world units* instead of isometric screen pixels —
 * this builder renders an actual Three.js scene rather than stacked rasters.
 */

export interface TerrainDef {
    id: string;
    name: string;
    category: Category;
    /** Path under public/ of the baked MagicaVoxel cell. */
    file: string;
    /**
     * Whether this cell can be raised / stacked (and built upon). Solid risers
     * (sand, stone, path) are stackable; surface cells (grass, water, sea wall)
     * are ground-level only for now.
     */
    stackable: boolean;
}

export type Category = 'terrain' | 'nature' | 'props' | 'buildings';

export const CATEGORIES: Category[] = [
    'terrain',
    'nature',
    'props',
    'buildings'
];

export const CONFIG = {
    grid: {
        width: 14,
        height: 14
    },

    voxel: {
        /** Voxels per cell edge — the terrain cells are a fixed 12×12 footprint. */
        perTile: 12,
        /** World units per voxel cube. */
        size: 1
    },

    /**
     * Number of voxel layers that sit *below* the ground datum (y = 0). The
     * terrain cells are authored so their lowest 4 layers are buried; anything
     * above layer 4 (grass tufts, sea walls) rises above ground. This makes a
     * single shared datum across cells of different heights.
     */
    groundLayers: 4,

    camera: {
        fov: 45,
        near: 0.1,
        far: 4000
    },

    storageKey: 'mykonos-three-scene.save.v2'
} as const;

/**
 * The tile catalog, loaded at boot from the dev-server controller
 * (`GET /api/tiles`, see vite-tiles-plugin.ts) rather than hardcoded, so tiles
 * authored in the editor and saved to disk show up here too. Both are mutated in
 * place by {@link setCatalog}/{@link addTile} so existing imports stay live.
 */
export const TERRAIN_MANIFEST: TerrainDef[] = [];

/** All tile defs, indexed by id. */
export const ASSET_INDEX: Record<string, TerrainDef> = {};

/** Replace the whole catalog (in place, so importers see the update). */
export function setCatalog(tiles: TerrainDef[]): void {
    TERRAIN_MANIFEST.length = 0;
    TERRAIN_MANIFEST.push(...tiles);
    for (const k of Object.keys(ASSET_INDEX)) delete ASSET_INDEX[k];
    for (const t of tiles) ASSET_INDEX[t.id] = t;
}

/** Add or replace a single tile (e.g. one just saved from the editor). */
export function addTile(def: TerrainDef): void {
    const i = TERRAIN_MANIFEST.findIndex(t => t.id === def.id);
    if (i >= 0) TERRAIN_MANIFEST[i] = def;
    else TERRAIN_MANIFEST.push(def);
    ASSET_INDEX[def.id] = def;
}

/** Fetch the catalog from the server, falling back to the static manifest. */
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

/** Tile defs for one category (empty for the not-yet-built top-layer tabs). */
export function assetsForCategory(cat: Category): TerrainDef[] {
    return TERRAIN_MANIFEST.filter(d => d.category === cat);
}

/** Whether a tile id can be raised / stacked (and built upon). */
export function isStackable(id: string): boolean {
    return ASSET_INDEX[id]?.stackable ?? false;
}
