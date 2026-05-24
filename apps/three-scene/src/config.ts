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

    storageKey: 'mykonos-three-scene.save.v1'
} as const;

/**
 * Terrain cells recreated in MagicaVoxel as 12×12×H voxels (stairs excluded —
 * those belong with buildings). Served from public/voxels/terrain.
 */
export const TERRAIN_MANIFEST: TerrainDef[] = [
    {
        id: 'grass',
        name: 'grass',
        category: 'terrain',
        file: '/voxels/terrain/grass.vox'
    },
    {
        id: 'sand',
        name: 'sand',
        category: 'terrain',
        file: '/voxels/terrain/sand.vox'
    },
    {
        id: 'path',
        name: 'path',
        category: 'terrain',
        file: '/voxels/terrain/path.vox'
    },
    {
        id: 'stone',
        name: 'stone',
        category: 'terrain',
        file: '/voxels/terrain/stone.vox'
    },
    {
        id: 'water',
        name: 'water',
        category: 'terrain',
        file: '/voxels/terrain/water.vox'
    },
    {
        id: 'sea_wall',
        name: 'sea wall',
        category: 'terrain',
        file: '/voxels/terrain/sea_wall.vox'
    }
];

/** All asset defs, indexed by id. */
export const ASSET_INDEX: Record<string, TerrainDef> = Object.fromEntries(
    TERRAIN_MANIFEST.map(d => [d.id, d])
);

/** Asset defs for one category (empty for the not-yet-built top-layer tabs). */
export function assetsForCategory(cat: Category): TerrainDef[] {
    return TERRAIN_MANIFEST.filter(d => d.category === cat);
}
