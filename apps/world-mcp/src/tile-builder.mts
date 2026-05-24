import { randomUUID } from 'node:crypto';

import { type Category, VOXEL_PER_TILE } from '@cbnsndwch/scene-author';
import {
    box,
    cylinder,
    dome,
    mergeVoxels,
    pyramidRoof,
    shell,
    type Voxel
} from '@cbnsndwch/world-core';

/** Footprint edge, in voxels (tiles are a fixed N×N footprint, variable height). */
const N = VOXEL_PER_TILE;

export type TileShape = 'box' | 'shell' | 'dome' | 'cylinder' | 'pyramid';

/** Superset of the primitive params; which are required depends on the shape. */
export interface ShapeParams {
    x?: number;
    y?: number;
    z?: number;
    w?: number;
    d?: number;
    h?: number;
    cx?: number;
    cy?: number;
    radius?: number;
    floor?: boolean;
    roof?: boolean;
    sides?: boolean;
}

function req(name: string, v: number | undefined): number {
    if (v == null || !Number.isFinite(v)) {
        throw new Error(`shape param "${name}" is required`);
    }
    return v;
}

/**
 * Build a shape's voxels via the world-core primitives — the same vocabulary the
 * biome renderer uses. Throws a friendly error if a required param is missing so
 * the tool can report it back to the agent.
 */
export function buildShape(
    shape: TileShape,
    p: ShapeParams,
    color: string
): Voxel[] {
    switch (shape) {
        case 'box':
            return box(
                req('x', p.x),
                req('y', p.y),
                req('z', p.z),
                req('w', p.w),
                req('d', p.d),
                req('h', p.h),
                color
            );
        case 'shell':
            return shell(
                req('x', p.x),
                req('y', p.y),
                req('z', p.z),
                req('w', p.w),
                req('d', p.d),
                req('h', p.h),
                color,
                { floor: p.floor, roof: p.roof, sides: p.sides ?? true }
            );
        case 'pyramid':
            return pyramidRoof(
                req('x', p.x),
                req('y', p.y),
                req('z', p.z),
                req('w', p.w),
                req('d', p.d),
                req('h', p.h),
                color
            );
        case 'dome':
            return dome(
                req('cx', p.cx),
                req('cy', p.cy),
                req('z', p.z),
                req('radius', p.radius),
                color
            );
        case 'cylinder':
            return cylinder(
                req('cx', p.cx),
                req('cy', p.cy),
                req('z', p.z),
                req('radius', p.radius),
                req('h', p.h),
                color
            );
    }
}

export interface TileAnalysis {
    voxelCount: number;
    /** SIZE for the baked `.vox`: the footprint edge × the stack height. */
    dims: [number, number, number];
    colorCount: number;
    /** Voxels lying outside the N×N footprint (x,y in [0,N), z >= 0). */
    outOfFootprint: number;
    /** Blocking problems; a tile saves only when this is empty. */
    errors: string[];
}

/** Inspect a tile's voxels against the footprint + `.vox` format constraints. */
export function analyzeTile(voxels: readonly Voxel[]): TileAnalysis {
    let maxZ = 0;
    let outOfFootprint = 0;
    const colors = new Set<string>();
    for (const v of voxels) {
        colors.add(v.c.toLowerCase());
        if (v.x < 0 || v.x >= N || v.y < 0 || v.y >= N || v.z < 0) {
            outOfFootprint++;
        }
        if (v.z > maxZ) maxZ = v.z;
    }

    const errors: string[] = [];
    if (voxels.length === 0) {
        errors.push('tile is empty — add a shape or voxels first');
    }
    if (outOfFootprint > 0) {
        errors.push(
            `${outOfFootprint} voxel(s) lie outside the ${N}x${N} footprint ` +
                `(x and y must be 0..${N - 1}, z >= 0)`
        );
    }
    if (colors.size > 255) {
        errors.push(
            `${colors.size} colors exceeds the 255-color limit for a baked tile`
        );
    }

    return {
        voxelCount: voxels.length,
        dims: [N, N, Math.max(1, maxZ + 1)],
        colorCount: colors.size,
        outOfFootprint,
        errors
    };
}

export interface TileMetaDraft {
    id: string | null;
    name: string | null;
    category: Category;
    stackable: boolean;
}

/**
 * An in-progress tile the agent is composing. Voxels are appended and deduped by
 * position at materialize time (a later write wins at a shared cell, so shapes
 * can paint over each other), matching the editor's merge semantics.
 */
export class TileBuilder {
    readonly id = randomUUID();
    readonly createdAt = new Date().toISOString();
    meta: TileMetaDraft;
    #voxels: Voxel[] = [];

    constructor(meta: Partial<TileMetaDraft> = {}) {
        const category = meta.category ?? 'terrain';
        this.meta = {
            id: meta.id ?? null,
            name: meta.name ?? null,
            category,
            stackable: meta.stackable ?? category === 'terrain'
        };
    }

    add(voxels: readonly Voxel[]): void {
        this.#voxels.push(...voxels);
    }

    clear(): void {
        this.#voxels = [];
    }

    /** Deduped voxels (later writes win at a shared position). */
    materialize(): Voxel[] {
        return mergeVoxels(this.#voxels);
    }
}

/** In-memory store of active tile-builder sessions, keyed by builder id. */
export class TileBuilderStore {
    readonly #builders = new Map<string, TileBuilder>();

    create(meta?: Partial<TileMetaDraft>): TileBuilder {
        const builder = new TileBuilder(meta);
        this.#builders.set(builder.id, builder);
        return builder;
    }

    get(id: string): TileBuilder | undefined {
        return this.#builders.get(id);
    }

    delete(id: string): boolean {
        return this.#builders.delete(id);
    }
}
