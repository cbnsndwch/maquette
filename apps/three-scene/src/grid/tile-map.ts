import { CONFIG } from '../config.js';

/** Quarter-turn rotation about a cell's vertical axis. */
export type Rotation = 0 | 1 | 2 | 3;

/** One occupied terrain cell: which asset, and how it's turned. */
export interface TerrainCell {
    id: string;
    rot: Rotation;
}

export type TerrainState = (TerrainCell | null)[];

/**
 * The world's terrain layer: a 2D grid of {@link TerrainCell}s (one per cell).
 * The "top layer" (props / buildings placed on top) is deferred.
 *
 * `terrainVersion` is bumped on every mutation so the scene view can cheaply
 * detect when it needs to rebuild its voxel meshes.
 */
export class TileMap {
    readonly width: number;
    readonly height: number;
    private terrain: TerrainState;

    terrainVersion = 0;

    constructor(width = CONFIG.grid.width, height = CONFIG.grid.height) {
        this.width = width;
        this.height = height;
        this.terrain = new Array(width * height).fill(null);
    }

    inBounds(gx: number, gy: number): boolean {
        return gx >= 0 && gy >= 0 && gx < this.width && gy < this.height;
    }

    setTerrain(gx: number, gy: number, cell: TerrainCell | null): void {
        if (!this.inBounds(gx, gy)) return;
        const idx = gy * this.width + gx;
        const cur = this.terrain[idx] ?? null;
        if (cur?.id === cell?.id && cur?.rot === cell?.rot) return;
        this.terrain[idx] = cell;
        this.terrainVersion++;
    }

    getTerrain(gx: number, gy: number): TerrainCell | null {
        if (!this.inBounds(gx, gy)) return null;
        return this.terrain[gy * this.width + gx] ?? null;
    }

    clearTerrain(gx: number, gy: number): void {
        this.setTerrain(gx, gy, null);
    }

    /** Iterate every occupied cell. */
    forEach(cb: (gx: number, gy: number, cell: TerrainCell) => void): void {
        for (let gy = 0; gy < this.height; gy++) {
            for (let gx = 0; gx < this.width; gx++) {
                const cell = this.terrain[gy * this.width + gx];
                if (cell) cb(gx, gy, cell);
            }
        }
    }

    clearAll(): void {
        this.terrain.fill(null);
        this.terrainVersion++;
    }

    /** Deep copy of the grid for the undo/redo history and save system. */
    snapshot(): TerrainState {
        return this.terrain.map(c => (c ? { ...c } : null));
    }

    /** Replace the whole grid (from a snapshot or saved state). */
    restore(state: TerrainState): void {
        this.terrain = state
            .slice(0, this.width * this.height)
            .map(c => (c ? { ...c } : null));
        while (this.terrain.length < this.width * this.height) {
            this.terrain.push(null);
        }
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
