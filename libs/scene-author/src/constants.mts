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

/**
 * Base voxels per cell edge. This is the *default* tile resolution; a tile may
 * declare a higher per-asset resolution `r` (see {@link ALLOWED_RESOLUTIONS})
 * to pack more detail into the same world cell — finer cubes, same physical
 * size. Terrain stays at this base.
 */
export const VOXEL_PER_TILE = 12;

/** World units per voxel cube at the base resolution. */
export const VOXEL_SIZE = 1;

/**
 * World units per cell edge — the constant world-cell anchor `P`. A tile of
 * resolution `r` fits `r` cubes of edge `P/r` across this same span, so raising
 * `r` never changes a cell's physical size (PRD identity `P = r · (P/r)`).
 */
export const WORLD_CELL = VOXEL_PER_TILE * VOXEL_SIZE;

/**
 * Voxel layers (at the base resolution) that sit *below* the ground datum
 * (y = 0). Terrain cells are authored so their lowest 4 layers are buried,
 * giving a single shared datum across cells of different heights.
 */
export const GROUND_LAYERS = 4;

/**
 * Buried depth below the ground datum, in **world units** (the resolution-
 * independent form of {@link GROUND_LAYERS}). A higher-`r` tile meets the same
 * datum by burying proportionally more of its (smaller) voxel layers.
 */
export const GROUND_DEPTH = GROUND_LAYERS * VOXEL_SIZE;

/**
 * Allowed per-asset resolutions `r` (voxels per cell edge). Restricted to
 * multiples of the base {@link VOXEL_PER_TILE} so a coarser asset always
 * upscales onto a finer common grid by an integer factor (PRD R2).
 */
export const ALLOWED_RESOLUTIONS = [12, 24, 36, 48] as const;

/** World edge of one voxel cube for a tile of resolution `r` (`P/r`). */
export function voxelSizeFor(resolution: number): number {
    return WORLD_CELL / resolution;
}

/** Buried base-layer count for a tile of resolution `r` (scales with `r`). */
export function groundLayersFor(resolution: number): number {
    return GROUND_LAYERS * (resolution / VOXEL_PER_TILE);
}

/** Whether `r` is an allowed resolution (a multiple of the base, in range). */
export function isAllowedResolution(resolution: number): boolean {
    return (ALLOWED_RESOLUTIONS as readonly number[]).includes(resolution);
}
