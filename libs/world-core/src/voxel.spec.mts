import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { rotateFootprintXY, VoxelBatch, type Voxel } from './voxel.mjs';

/** The original square-only rotation, kept here as the regression oracle. */
function legacySquareRotate(
    x: number,
    y: number,
    rot: 0 | 1 | 2 | 3,
    span: number
): [number, number] {
    if (rot === 1) return [y, span - 1 - x];
    if (rot === 2) return [span - 1 - x, span - 1 - y];
    if (rot === 3) return [span - 1 - y, x];
    return [x, y];
}

describe('rotateFootprintXY', () => {
    it('is bit-identical to the legacy square formula for every cell', () => {
        const span = 12;
        for (const rot of [0, 1, 2, 3] as const) {
            for (let x = 0; x < span; x++) {
                for (let y = 0; y < span; y++) {
                    expect(rotateFootprintXY(x, y, rot, span, span)).toEqual(
                        legacySquareRotate(x, y, rot, span)
                    );
                }
            }
        }
    });

    it('rotates a non-square (2×1) footprint into a 1×2 at 90°/270°', () => {
        // spanX=2, spanY=1 — a 2-wide, 1-deep block.
        // rot 1: (x,y) → (y, spanX-1-x); footprint becomes 1×2.
        expect(rotateFootprintXY(0, 0, 1, 2, 1)).toEqual([0, 1]);
        expect(rotateFootprintXY(1, 0, 1, 2, 1)).toEqual([0, 0]);
        // rot 2: (x,y) → (spanX-1-x, spanY-1-y); stays 2×1.
        expect(rotateFootprintXY(0, 0, 2, 2, 1)).toEqual([1, 0]);
        expect(rotateFootprintXY(1, 0, 2, 2, 1)).toEqual([0, 0]);
        // rot 3: (x,y) → (spanY-1-y, x); footprint becomes 1×2.
        expect(rotateFootprintXY(0, 0, 3, 2, 1)).toEqual([0, 0]);
        expect(rotateFootprintXY(1, 0, 3, 2, 1)).toEqual([0, 1]);
    });

    it('keeps every rotated cell inside the rotated footprint extent', () => {
        const spanX = 3;
        const spanY = 2;
        for (const rot of [0, 1, 2, 3] as const) {
            const swap = rot === 1 || rot === 3;
            const rw = swap ? spanY : spanX;
            const rh = swap ? spanX : spanY;
            for (let x = 0; x < spanX; x++) {
                for (let y = 0; y < spanY; y++) {
                    const [rx, ry] = rotateFootprintXY(x, y, rot, spanX, spanY);
                    expect(rx).toBeGreaterThanOrEqual(0);
                    expect(ry).toBeGreaterThanOrEqual(0);
                    expect(rx).toBeLessThan(rw);
                    expect(ry).toBeLessThan(rh);
                }
            }
        }
    });
});

/** Read the world translation of instance `i` from a built VoxelBatch group. */
function instancePos(group: THREE.Group, i: number): [number, number, number] {
    const mesh = group.children[0] as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(i, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    return [p.x, p.y, p.z];
}

describe('VoxelBatch rectangular rotation', () => {
    const v = (x: number, y: number, z: number): Voxel => ({
        x,
        y,
        z,
        c: '#ffffff'
    });

    it('maps voxel x→X, z→Y, y→Z and centers cubes (no rotation)', () => {
        const batch = new VoxelBatch(1);
        batch.add([v(1, 2, 3)], { origin: [0, 0, 0] });
        expect(instancePos(batch.build(), 0)).toEqual([1.5, 3.5, 2.5]);
    });

    it('applies a rectangular (2×1) footprint rotation', () => {
        const batch = new VoxelBatch(1);
        // (1,0,0) under rot 1 with spanX=2,spanY=1 → (0,0) → world (0.5, 0.5, 0.5)
        batch.add([v(1, 0, 0)], {
            origin: [0, 0, 0],
            rotation: 1,
            spanX: 2,
            spanY: 1
        });
        expect(instancePos(batch.build(), 0)).toEqual([0.5, 0.5, 0.5]);
    });

    it('treats `span` as the square shorthand', () => {
        const square = new VoxelBatch(1);
        square.add([v(0, 0, 0)], { origin: [0, 0, 0], rotation: 1, span: 12 });
        const rect = new VoxelBatch(1);
        rect.add([v(0, 0, 0)], {
            origin: [0, 0, 0],
            rotation: 1,
            spanX: 12,
            spanY: 12
        });
        expect(instancePos(square.build(), 0)).toEqual(
            instancePos(rect.build(), 0)
        );
    });
});
