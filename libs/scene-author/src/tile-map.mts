import { footprintOf } from './catalog.mjs';
import { DEFAULT_GRID } from './constants.mjs';

/** Quarter-turn rotation about a cell's vertical axis. */
export type Rotation = 0 | 1 | 2 | 3;

/** One placed terrain cell: which asset, and how it's turned. */
export interface TerrainCell {
    id: string;
    rot: Rotation;
}

/** A column is a bottom→top stack of cells; the grid is one column per (gx, gy). */
export type TerrainState = TerrainCell[][];

/**
 * A multi-cell building placement (PRD §4, Option B). Stored in a separate
 * overlay from the terrain stacks: a single asset occupying a `w × d` block of
 * cells, anchored at its **min-corner** `(ax, ay)` and resting on one shared
 * `baseLevel` (the voxel altitude its z = 0 sits at).
 */
export interface BuildingPlacement {
    id: string;
    /** Anchor = min-corner cell of the footprint. */
    ax: number;
    ay: number;
    rot: Rotation;
    /** Voxel altitude the building's z = 0 rests at (the level terrain surface). */
    baseLevel: number;
}

/** A grid cell coordinate. */
export interface Cell {
    gx: number;
    gy: number;
}

/** The undoable / persistable world state: terrain stacks + building overlay. */
export interface WorldSnapshot {
    terrain: TerrainState;
    buildings: BuildingPlacement[];
}

/** The serialized scene document shape (`TileMap.serialize()` output). */
export interface SerializedScene {
    width: number;
    height: number;
    terrain: TerrainState;
    buildings: BuildingPlacement[];
}

/** Footprint dims `[w, d]` rotated by `rot` quarter-turns (90°/270° swap axes). */
export function rotatedFootprint(
    w: number,
    d: number,
    rot: Rotation
): [number, number] {
    return rot === 1 || rot === 3 ? [d, w] : [w, d];
}

/**
 * Grid cells a building covers: its rotated footprint laid out from the anchor
 * (min-corner) toward +x/+y. The anchor is always part of the footprint, so two
 * buildings can never share an anchor without also overlapping.
 */
export function buildingCells(b: BuildingPlacement): Cell[] {
    const [fw, fd] = footprintOf(b.id);
    const [rw, rh] = rotatedFootprint(fw, fd, b.rot);
    const cells: Cell[] = [];
    for (let dy = 0; dy < rh; dy++) {
        for (let dx = 0; dx < rw; dx++) {
            cells.push({ gx: b.ax + dx, gy: b.ay + dy });
        }
    }
    return cells;
}

/**
 * The world's terrain layer: a grid of vertical **stacks**, one per (gx, gy)
 * column. The bottom cell sits at ground level; each cell above rests on the one
 * below, so a column's altitude is simply the cumulative height of its cells —
 * stored implicitly by stack order rather than as an explicit number.
 *
 * `terrainVersion` is bumped on every mutation so the scene view can cheaply
 * detect when it needs to rebuild its voxel meshes.
 */
export class TileMap {
    readonly width: number;
    readonly height: number;
    private columns: TerrainState;
    /** Multi-cell building overlay (PRD §4, Option B). */
    private buildings: BuildingPlacement[] = [];
    /** Occupancy index: cell key `"gx,gy"` → the building covering it. */
    private occupancy = new Map<string, BuildingPlacement>();

    terrainVersion = 0;

    constructor(
        width: number = DEFAULT_GRID.width,
        height: number = DEFAULT_GRID.height
    ) {
        this.width = width;
        this.height = height;
        this.columns = Array.from({ length: width * height }, () => []);
    }

    inBounds(gx: number, gy: number): boolean {
        return gx >= 0 && gy >= 0 && gx < this.width && gy < this.height;
    }

    /** The stack at a column, bottom→top (empty array if nothing placed). */
    getStack(gx: number, gy: number): readonly TerrainCell[] {
        if (!this.inBounds(gx, gy)) return [];
        return this.columns[gy * this.width + gx]!;
    }

    /** Number of cells stacked in a column. */
    stackHeight(gx: number, gy: number): number {
        return this.getStack(gx, gy).length;
    }

    /** Top (most recently placed) cell of a column, or null if empty. */
    topCell(gx: number, gy: number): TerrainCell | null {
        const stack = this.getStack(gx, gy);
        return stack.length ? stack[stack.length - 1]! : null;
    }

    /** Push a cell onto the top of a column. */
    push(gx: number, gy: number, cell: TerrainCell): void {
        if (!this.inBounds(gx, gy)) return;
        this.columns[gy * this.width + gx]!.push(cell);
        this.terrainVersion++;
    }

    /** Pop the top cell off a column. Returns it, or null if the column is empty. */
    pop(gx: number, gy: number): TerrainCell | null {
        if (!this.inBounds(gx, gy)) return null;
        const stack = this.columns[gy * this.width + gx]!;
        if (!stack.length) return null;
        const cell = stack.pop()!;
        this.terrainVersion++;
        return cell;
    }

    /** Replace the cell at a specific index in a column's stack. */
    replaceAt(gx: number, gy: number, index: number, cell: TerrainCell): void {
        if (!this.inBounds(gx, gy)) return;
        const stack = this.columns[gy * this.width + gx]!;
        if (index >= 0 && index < stack.length) {
            stack[index] = cell;
            this.terrainVersion++;
        }
    }

    /** Iterate every non-empty column with its bottom→top stack. */
    forEachColumn(
        cb: (gx: number, gy: number, stack: readonly TerrainCell[]) => void
    ): void {
        for (let gy = 0; gy < this.height; gy++) {
            for (let gx = 0; gx < this.width; gx++) {
                const stack = this.columns[gy * this.width + gx]!;
                if (stack.length) cb(gx, gy, stack);
            }
        }
    }

    /* ── Building overlay ─────────────────────────────────────── */

    /** Every placed building, in placement order. */
    getBuildings(): readonly BuildingPlacement[] {
        return this.buildings;
    }

    /** The building covering a cell, or null. Resolves any covered cell → anchor. */
    buildingAt(gx: number, gy: number): BuildingPlacement | null {
        return this.occupancy.get(`${gx},${gy}`) ?? null;
    }

    /** Add a building to the overlay (caller has already validated placement). */
    addBuilding(b: BuildingPlacement): void {
        this.buildings.push(b);
        for (const c of buildingCells(b)) {
            this.occupancy.set(`${c.gx},${c.gy}`, b);
        }
        this.terrainVersion++;
    }

    /** Remove a building. Returns true if it was present. */
    removeBuilding(b: BuildingPlacement): boolean {
        const i = this.buildings.indexOf(b);
        if (i < 0) return false;
        this.buildings.splice(i, 1);
        this.rebuildOccupancy();
        this.terrainVersion++;
        return true;
    }

    private rebuildOccupancy(): void {
        this.occupancy.clear();
        for (const b of this.buildings) {
            for (const c of buildingCells(b)) {
                this.occupancy.set(`${c.gx},${c.gy}`, b);
            }
        }
    }

    /* ── Whole-world state ────────────────────────────────────── */

    clearAll(): void {
        for (const stack of this.columns) stack.length = 0;
        this.buildings = [];
        this.occupancy.clear();
        this.terrainVersion++;
    }

    /** Deep copy of the world for the undo/redo history and save system. */
    snapshot(): WorldSnapshot {
        return {
            terrain: this.columns.map(stack => stack.map(c => ({ ...c }))),
            buildings: this.buildings.map(b => ({ ...b }))
        };
    }

    /** Replace the whole world (from a snapshot or saved state). */
    restore(state: WorldSnapshot): void {
        this.columns = Array.from(
            { length: this.width * this.height },
            (_, i) => {
                const stack = state.terrain[i];
                return Array.isArray(stack) ? stack.map(c => ({ ...c })) : [];
            }
        );
        this.buildings = (state.buildings ?? []).map(b => ({ ...b }));
        this.rebuildOccupancy();
        this.terrainVersion++;
    }

    serialize(): SerializedScene {
        const snap = this.snapshot();
        return {
            width: this.width,
            height: this.height,
            terrain: snap.terrain,
            buildings: snap.buildings
        };
    }

    load(data: Partial<SerializedScene> | null): boolean {
        if (
            !data ||
            data.width !== this.width ||
            data.height !== this.height ||
            !data.terrain
        ) {
            return false;
        }
        this.restore({
            terrain: data.terrain,
            buildings: data.buildings ?? []
        });
        return true;
    }
}
