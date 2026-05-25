/**
 * The tile catalog: the vocabulary of placeable cells, indexed by id.
 *
 * The catalog is a process-level singleton (`TERRAIN_MANIFEST` / `ASSET_INDEX`)
 * mutated in place by {@link setCatalog} / {@link addTile} / {@link removeTile},
 * so existing imports stay live across an update. The editor loads it from its
 * dev-server (`GET /api/tiles`); the headless server loads it from the same
 * `catalog.json` on disk — both call {@link setCatalog} once at startup.
 */

import { VOXEL_PER_TILE } from './constants.mjs';

export type Category = 'terrain' | 'nature' | 'props' | 'buildings';

export const CATEGORIES: Category[] = [
    'terrain',
    'nature',
    'props',
    'buildings'
];

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

    /**
     * Rectangular grid footprint `[w, d]` in cells (default `[1, 1]`). A tile
     * with a multi-cell footprint is authored at `(w·12) × (d·12)` voxels and
     * placed/rotated/erased as one atomic building unit (the separate placements
     * overlay), rather than a per-column terrain stack.
     */
    footprint?: [number, number];

    /**
     * Per-asset resolution `r` (voxels per cell edge), default
     * {@link VOXEL_PER_TILE} = 12. A higher `r` renders finer cubes (`P/r`) in
     * the **same** world cell, so an ornate asset can carry more detail without
     * changing its footprint. Its `.vox` is authored at `(r·w) × (r·d)` voxels.
     * Must be one of {@link ALLOWED_RESOLUTIONS}.
     */
    resolution?: number;

    /**
     * Soft-deleted: hidden from the palette/inspector but its `.vox` file and
     * catalog entry are retained on disk (deletes are reversible by hand).
     */
    deleted?: boolean;
}

/** The live catalog, in catalog order (soft-deleted tiles excluded). */
export const TERRAIN_MANIFEST: TerrainDef[] = [];

/** All live tile defs, indexed by id. */
export const ASSET_INDEX: Record<string, TerrainDef> = {};

/**
 * Replace the whole catalog (in place, so importers see the update).
 * Soft-deleted tiles are dropped — callers keep their files + entries, but the
 * running process treats them as gone.
 */
export function setCatalog(tiles: TerrainDef[]): void {
    const live = tiles.filter(t => !t.deleted);
    TERRAIN_MANIFEST.length = 0;
    TERRAIN_MANIFEST.push(...live);
    for (const k of Object.keys(ASSET_INDEX)) delete ASSET_INDEX[k];
    for (const t of live) ASSET_INDEX[t.id] = t;
}

/** Drop a tile from the in-memory catalog (after a soft delete on disk). */
export function removeTile(id: string): void {
    const i = TERRAIN_MANIFEST.findIndex(t => t.id === id);
    if (i >= 0) TERRAIN_MANIFEST.splice(i, 1);
    delete ASSET_INDEX[id];
}

/** Add or replace a single tile (e.g. one just saved from the editor). */
export function addTile(def: TerrainDef): void {
    const i = TERRAIN_MANIFEST.findIndex(t => t.id === def.id);
    if (i >= 0) TERRAIN_MANIFEST[i] = def;
    else TERRAIN_MANIFEST.push(def);
    ASSET_INDEX[def.id] = def;
}

/** Tile defs for one category (empty for not-yet-built categories). */
export function assetsForCategory(cat: Category): TerrainDef[] {
    return TERRAIN_MANIFEST.filter(d => d.category === cat);
}

/** Whether a tile id can be raised / stacked (and built upon). */
export function isStackable(id: string): boolean {
    return ASSET_INDEX[id]?.stackable ?? false;
}

/** Grid footprint `[w, d]` in cells for a tile id (defaults to `[1, 1]`). */
export function footprintOf(id: string): [number, number] {
    const fp = ASSET_INDEX[id]?.footprint;
    return fp ? [fp[0], fp[1]] : [1, 1];
}

/** Per-asset resolution `r` (voxels per cell edge) for a tile id, default 12. */
export function resolutionOf(id: string): number {
    return ASSET_INDEX[id]?.resolution ?? VOXEL_PER_TILE;
}

/** True when a tile occupies more than one grid cell (a building unit). */
export function isMultiCell(id: string): boolean {
    const [w, d] = footprintOf(id);
    return w > 1 || d > 1;
}

/**
 * Nature and props tiles are *ground-anchored*: they render at the column base
 * (z = 0) so they clip into terrain instead of riding on top of it, and they
 * never advance a column's altitude.
 */
export function isGroundAnchored(id: string): boolean {
    const cat = ASSET_INDEX[id]?.category;
    return cat === 'nature' || cat === 'props';
}
