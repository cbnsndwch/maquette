import { ASSET_INDEX } from '../config.js';
import type { Rotation, TileMap } from './tile-map.js';

export type PlaceResult = {
    kind: 'terrain';
    gx: number;
    gy: number;
    assetId: string;
} | null;

/**
 * Bridges the user's intent (selected asset + hovered cell + brush rotation) to
 * the {@link TileMap}. Only the terrain layer exists for now; the top layer
 * (props/buildings) will add footprint-based objects here later.
 */
export class PlacementSystem {
    constructor(private readonly tileMap: TileMap) {}

    canPlace(assetId: string, gx: number, gy: number): boolean {
        if (!ASSET_INDEX[assetId]) return false;
        return this.tileMap.inBounds(gx, gy);
    }

    place(assetId: string, gx: number, gy: number, rot: Rotation): PlaceResult {
        if (!this.canPlace(assetId, gx, gy)) return null;
        this.tileMap.setTerrain(gx, gy, { id: assetId, rot });
        return { kind: 'terrain', gx, gy, assetId };
    }

    /** Erase whatever sits on the cell. Returns true if anything was removed. */
    erase(gx: number, gy: number): boolean {
        if (this.tileMap.getTerrain(gx, gy)) {
            this.tileMap.clearTerrain(gx, gy);
            return true;
        }
        return false;
    }
}
