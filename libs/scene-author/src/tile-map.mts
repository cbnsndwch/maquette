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

    clearAll(): void {
        for (const stack of this.columns) stack.length = 0;
        this.terrainVersion++;
    }

    /** Deep copy of the grid for the undo/redo history and save system. */
    snapshot(): TerrainState {
        return this.columns.map(stack => stack.map(c => ({ ...c })));
    }

    /** Replace the whole grid (from a snapshot or saved state). */
    restore(state: TerrainState): void {
        this.columns = Array.from(
            { length: this.width * this.height },
            (_, i) => {
                const stack = state[i];
                return Array.isArray(stack) ? stack.map(c => ({ ...c })) : [];
            }
        );
        this.terrainVersion++;
    }

    serialize(): { width: number; height: number; terrain: TerrainState } {
        return {
            width: this.width,
            height: this.height,
            terrain: this.snapshot()
        };
    }

    load(
        data: { width: number; height: number; terrain: TerrainState } | null
    ): boolean {
        if (!data || data.width !== this.width || data.height !== this.height) {
            return false;
        }
        this.restore(data.terrain);
        return true;
    }
}
