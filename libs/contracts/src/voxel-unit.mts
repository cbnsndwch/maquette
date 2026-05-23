import { z } from 'zod';

/**
 * VoxelUnit — a single palette-agnostic voxel prop on a fixed 12×12 footprint
 * with variable height.
 *
 * It is the shared output of both generation paths of the local voxel pipeline
 * (`apps/voxel-pipeline-ab`):
 *
 * - **Path A** — an LLM emits the cell grid directly as JSON.
 * - **Path B** — a concept image is turned into a mesh (TripoSR) and voxelized.
 *
 * Cells reference biome palette *slots* by name (`materialId`) rather than
 * concrete colors, so the same unit can be re-skinned per track. The `.vox`
 * (MagicaVoxel) export is a derived serialization of this schema, loaded by the
 * Three.js renderer.
 */

/** Footprint side length, in voxels. Both x and y are fixed at this value. */
export const VOXEL_FOOTPRINT = 12;

/** Bump when the schema changes in a backwards-incompatible way. */
export const VOXEL_UNIT_VERSION = 1;

/**
 * Chunk-merge block size. The merge pass collapses runs of identical, adjacent
 * cells into larger cubes for the variable-block-size look; `1` is an unmerged
 * default cell.
 */
export const voxelCellSizeSchema = z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3)
]);
export type VoxelCellSize = z.infer<typeof voxelCellSizeSchema>;

export const voxelCellSchema = z.object({
    /** Biome palette slot name, e.g. `'primary'`, `'accent'`, `'bark'`. */
    materialId: z.string(),
    /** Chunk-merge output cube size; defaults to `1` (a single voxel). */
    size: voxelCellSizeSchema.default(1)
});
export type VoxelCell = z.infer<typeof voxelCellSchema>;

/**
 * A cell slot in the grid: either an occupied {@link VoxelCell} or `null` for
 * empty space.
 */
export const voxelCellSlotSchema = voxelCellSchema.nullable();

/** Grid dimensions. `x`/`y` are pinned to {@link VOXEL_FOOTPRINT}; `z` varies. */
export const voxelDimsSchema = z.object({
    x: z.literal(VOXEL_FOOTPRINT),
    y: z.literal(VOXEL_FOOTPRINT),
    /** Height in voxels (number of z-layers). */
    z: z.number().int().positive()
});
export type VoxelDims = z.infer<typeof voxelDimsSchema>;

/** Footprint center the unit is placed by; usually `[6, 6]`. */
export const voxelPivotSchema = z.object({
    x: z.number(),
    y: z.number()
});
export type VoxelPivot = z.infer<typeof voxelPivotSchema>;

export const voxelUnitSchema = z.object({
    version: z.literal(VOXEL_UNIT_VERSION).default(VOXEL_UNIT_VERSION),
    /** Stable id, e.g. `'tree-olive'`, `'arch-gate'`. */
    id: z.string(),
    /** Biome whose palette slots `materialId`s refer to (e.g. `'mykonos'`). */
    biome: z.string(),
    dims: voxelDimsSchema,
    /**
     * The voxel grid, indexed `[z][y][x]`. `null` marks an empty cell. The outer
     * length is `dims.z`; each layer is {@link VOXEL_FOOTPRINT}×{@link VOXEL_FOOTPRINT}.
     */
    cells: z.array(z.array(z.array(voxelCellSlotSchema))),
    pivot: voxelPivotSchema.default({ x: 6, y: 6 }),
    metadata: z.record(z.string(), z.unknown()).optional()
});

/** The fully-resolved VoxelUnit type (defaults applied). */
export type VoxelUnit = z.infer<typeof voxelUnitSchema>;

/**
 * Validate that a unit's `cells` array matches its declared `dims` (z-depth and
 * the fixed footprint on every layer/row). Returns the issue strings; empty when
 * the shape is consistent.
 */
export function voxelUnitShapeIssues(unit: VoxelUnit): string[] {
    const issues: string[] = [];
    const { x, y, z } = unit.dims;
    if (unit.cells.length !== z) {
        issues.push(`expected ${z} z-layers, got ${unit.cells.length}`);
    }
    unit.cells.forEach((layer, zi) => {
        if (layer.length !== y) {
            issues.push(`layer ${zi}: expected ${y} rows, got ${layer.length}`);
        }
        layer.forEach((row, yi) => {
            if (row.length !== x) {
                issues.push(
                    `layer ${zi} row ${yi}: expected ${x} cols, got ${row.length}`
                );
            }
        });
    });
    return issues;
}

/** Parse and validate unknown input into a VoxelUnit, throwing on failure. */
export function validateVoxelUnit(input: unknown): VoxelUnit {
    const unit = voxelUnitSchema.parse(input);
    const issues = voxelUnitShapeIssues(unit);
    if (issues.length > 0) {
        throw new Error(`VoxelUnit shape mismatch: ${issues.join('; ')}`);
    }
    return unit;
}

/** Non-throwing variant of {@link validateVoxelUnit}. */
export function safeValidateVoxelUnit(input: unknown) {
    const parsed = voxelUnitSchema.safeParse(input);
    if (!parsed.success) {
        return parsed;
    }
    const issues = voxelUnitShapeIssues(parsed.data);
    if (issues.length > 0) {
        return {
            success: false as const,
            error: new Error(`VoxelUnit shape mismatch: ${issues.join('; ')}`)
        };
    }
    return parsed;
}
