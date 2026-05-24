import { ASSET_INDEX, isStackable } from '../config.js';
import type { Rotation, TileMap } from './tile-map.js';

export type PlaceResult = {
    kind: 'terrain';
    gx: number;
    gy: number;
    assetId: string;
    level: number;
} | null;

/**
 * Bridges the user's intent (selected asset + hovered column + brush rotation)
 * to the {@link TileMap}. Placing pushes a cell onto the column's stack, so
 * repeated placements raise terraced terrain.
 */
export class PlacementSystem {
    constructor(private readonly tileMap: TileMap) {}

    /**
     * A cell can always start a column at ground level. Stacking onto an existing
     * column depends only on the *supporting* top cell being stackable: terrain
     * (grass, sand, stone, path, water) accepts more terrain or a prop/structure
     * on top, while mixed terrain+structure cells (e.g. sea wall) and props are
     * not stackable, so nothing lands on them.
     */
    canPlace(assetId: string, gx: number, gy: number): boolean {
        if (!ASSET_INDEX[assetId] || !this.tileMap.inBounds(gx, gy)) {
            return false;
        }
        const top = this.tileMap.topCell(gx, gy);
        if (!top) return true;
        return isStackable(top.id);
    }

    place(assetId: string, gx: number, gy: number, rot: Rotation): PlaceResult {
        if (!this.canPlace(assetId, gx, gy)) return null;
        this.tileMap.push(gx, gy, { id: assetId, rot });
        return {
            kind: 'terrain',
            gx,
            gy,
            assetId,
            level: this.tileMap.stackHeight(gx, gy) - 1
        };
    }

    /** Erase the top cell of a column. Returns true if anything was removed. */
    erase(gx: number, gy: number): boolean {
        return this.tileMap.pop(gx, gy) !== null;
    }
}
