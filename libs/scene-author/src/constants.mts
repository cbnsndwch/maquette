/**
 * Scene-shape constants shared by the editor and the headless authoring server.
 *
 * These are the dimensions that the scene document, placement rules and `.vox`
 * composition all depend on. They live here — not in any one app's config — so
 * both the `three-scene` editor and the `world-mcp` server agree on the same
 * grid footprint and voxel footprint without forking the numbers.
 */

/** Default terrain grid footprint, in columns. */
export const DEFAULT_GRID = { width: 14, height: 14 } as const;

/** Voxels per cell edge — terrain cells are a fixed 12×12 footprint. */
export const VOXEL_PER_TILE = 12;

/** World units per voxel cube. */
export const VOXEL_SIZE = 1;

/**
 * Voxel layers that sit *below* the ground datum (y = 0). Terrain cells are
 * authored so their lowest 4 layers are buried, giving a single shared datum
 * across cells of different heights.
 */
export const GROUND_LAYERS = 4;
