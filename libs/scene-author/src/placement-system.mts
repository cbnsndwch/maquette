import { ASSET_INDEX, isStackable } from './catalog.mjs';
import type { Rotation, TileMap } from './tile-map.mjs';

export type PlaceResult = {
    kind: 'terrain';
    gx: number;
    gy: number;
    assetId: string;
    level: number;
} | null;

/** Machine-readable reason a placement was rejected. */
export type PlacementError = 'unknown_tile' | 'out_of_bounds' | 'not_stackable';

/** Result of probing a placement without mutating the map. */
export type PlacementCheck =
    | { ok: true }
    | { ok: false; reason: PlacementError };

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
     *
     * Returns a structured reason on rejection so a headless caller (the MCP
     * server) can self-correct; {@link canPlace} is the boolean form used by the
     * editor's hover preview.
     */
    checkPlace(assetId: string, gx: number, gy: number): PlacementCheck {
        if (!ASSET_INDEX[assetId]) {
            return { ok: false, reason: 'unknown_tile' };
        }
        if (!this.tileMap.inBounds(gx, gy)) {
            return { ok: false, reason: 'out_of_bounds' };
        }
        const top = this.tileMap.topCell(gx, gy);
        if (top && !isStackable(top.id)) {
            // Terrain tiles are allowed even when the top is non-stackable: they
            // replace the topmost terrain tile already in the column, leaving any
            // nature/props tiles above it in place (since those are ground-anchored).
            if (ASSET_INDEX[assetId]?.category === 'terrain') return { ok: true };
            return { ok: false, reason: 'not_stackable' };
        }
        return { ok: true };
    }

    canPlace(assetId: string, gx: number, gy: number): boolean {
        return this.checkPlace(assetId, gx, gy).ok;
    }

    place(assetId: string, gx: number, gy: number, rot: Rotation): PlaceResult {
        if (!this.canPlace(assetId, gx, gy)) return null;

        const top = this.tileMap.topCell(gx, gy);
        if (top && !isStackable(top.id) && ASSET_INDEX[assetId]?.category === 'terrain') {
            // Find the topmost terrain tile in the stack and replace it in-place.
            const stack = this.tileMap.getStack(gx, gy);
            for (let i = stack.length - 1; i >= 0; i--) {
                if (ASSET_INDEX[stack[i]!.id]?.category === 'terrain') {
                    this.tileMap.replaceAt(gx, gy, i, { id: assetId, rot });
                    return { kind: 'terrain', gx, gy, assetId, level: i };
                }
            }
            // No terrain tile found — fall through to push (degenerate case).
        }

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
