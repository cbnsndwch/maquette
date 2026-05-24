import { describe, expect, it } from 'vitest';

import {
    VOXEL_FOOTPRINT,
    VOXEL_UNIT_VERSION,
    safeValidateVoxelUnit,
    validateVoxelUnit,
    voxelCellSchema,
    voxelUnitShapeIssues,
    type VoxelUnit
} from './voxel-unit.mjs';

function emptyLayer() {
    return Array.from({ length: VOXEL_FOOTPRINT }, () =>
        Array.from({ length: VOXEL_FOOTPRINT }, () => null)
    );
}

function makeUnit(height = 2): unknown {
    const cells = Array.from({ length: height }, () => emptyLayer());
    cells[0]![6]![6] = { materialId: 'bark', size: 1 } as never;
    return {
        version: VOXEL_UNIT_VERSION,
        id: 'tree',
        biome: 'mykonos',
        dims: { x: VOXEL_FOOTPRINT, y: VOXEL_FOOTPRINT, z: height },
        cells,
        pivot: { x: 6, y: 6 }
    };
}

describe('voxelCellSchema', () => {
    it('defaults size to 1', () => {
        expect(voxelCellSchema.parse({ materialId: 'stone' }).size).toBe(1);
    });

    it('rejects out-of-range sizes', () => {
        expect(
            voxelCellSchema.safeParse({ materialId: 'stone', size: 4 }).success
        ).toBe(false);
    });
});

describe('validateVoxelUnit', () => {
    it('accepts a well-formed unit', () => {
        const unit = validateVoxelUnit(makeUnit(2));
        expect(unit.dims.z).toBe(2);
        expect(unit.cells[0]![6]![6]).toEqual({ materialId: 'bark', size: 1 });
    });

    it('applies the default pivot', () => {
        const raw = makeUnit(1) as Record<string, unknown>;
        delete raw.pivot;
        expect(validateVoxelUnit(raw).pivot).toEqual({ x: 6, y: 6 });
    });

    it('throws when cell depth disagrees with dims.z', () => {
        const raw = makeUnit(2) as { dims: { z: number } };
        raw.dims.z = 3; // claims 3 layers but only 2 present
        expect(() => validateVoxelUnit(raw)).toThrow(/shape mismatch/);
    });

    it('throws when a layer is not the full footprint', () => {
        const raw = makeUnit(1) as { cells: unknown[][] };
        (raw.cells[0] as unknown[]).pop();
        expect(() => validateVoxelUnit(raw)).toThrow(/shape mismatch/);
    });
});

describe('safeValidateVoxelUnit', () => {
    it('returns success for a valid unit', () => {
        expect(safeValidateVoxelUnit(makeUnit(1)).success).toBe(true);
    });

    it('returns failure (not throw) on a shape mismatch', () => {
        const raw = makeUnit(1) as { dims: { z: number } };
        raw.dims.z = 5;
        const res = safeValidateVoxelUnit(raw);
        expect(res.success).toBe(false);
    });
});

describe('voxelUnitShapeIssues', () => {
    it('reports no issues for a consistent unit', () => {
        const unit = validateVoxelUnit(makeUnit(2)) as VoxelUnit;
        expect(voxelUnitShapeIssues(unit)).toEqual([]);
    });
});
