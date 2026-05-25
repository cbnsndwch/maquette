import {
    ASSET_INDEX,
    isGroundAnchored,
    isMultiCell,
    isStackable
} from './catalog.mjs';
import {
    buildingCells,
    type BuildingPlacement,
    type Rotation,
    type TileMap
} from './tile-map.mjs';

export type PlaceResult =
    | {
          kind: 'terrain';
          gx: number;
          gy: number;
          assetId: string;
          level: number;
      }
    | {
          kind: 'building';
          ax: number;
          ay: number;
          assetId: string;
          rot: Rotation;
          baseLevel: number;
      }
    | null;

/** Machine-readable reason a placement was rejected. */
export type PlacementError =
    | 'unknown_tile'
    | 'out_of_bounds'
    | 'not_stackable'
    | 'occupied'
    | 'not_level';

/** Result of probing a placement without mutating the map. */
export type PlacementCheck =
    | { ok: true }
    | { ok: false; reason: PlacementError };

/**
 * Bridges the user's intent (selected asset + hovered cell + brush rotation) to
 * the {@link TileMap}. Single-cell tiles push onto a column's stack (repeated
 * placements raise terraced terrain); multi-cell tiles (footprint > 1×1) are
 * placed as one atomic building in the overlay, reserving every covered cell.
 *
 * `heightOf` resolves a tile's **world** height (its `.vox` SIZE z scaled by the
 * asset's voxel size `P/r`), used to compute the level terrain surface under a
 * footprint. World units keep heights comparable across mixed-resolution columns
 * (PRD §5.1). It defaults to 1 unit/cell so the shared core stays usable without
 * a voxel source; both apps inject a real, dims-and-resolution-backed function.
 */
export class PlacementSystem {
    constructor(
        private readonly tileMap: TileMap,
        private readonly heightOf: (id: string) => number = () => 1
    ) {}

    /**
     * Cumulative **world-unit** altitude of the terrain surface at a column —
     * the sum of non-ground-anchored cell heights (nature/props clip in at
     * z = 0 and don't raise the surface). This is the altitude a building
     * rests on (its `baseLevel`).
     */
    columnBase(gx: number, gy: number): number {
        let base = 0;
        for (const c of this.tileMap.getStack(gx, gy)) {
            if (!isGroundAnchored(c.id)) base += this.heightOf(c.id);
        }
        return base;
    }

    /**
     * Probe a placement. Single-cell: a cell can always start a column; stacking
     * depends on the supporting top being stackable (terrain may replace the
     * topmost terrain even on a non-stackable top). A cell covered by a building
     * rejects with `occupied`. Multi-cell: see {@link checkPlaceFootprint}.
     *
     * Returns a structured reason on rejection so a headless caller (the MCP
     * server) can self-correct; {@link canPlace} is the boolean form.
     */
    checkPlace(
        assetId: string,
        gx: number,
        gy: number,
        rot: Rotation = 0
    ): PlacementCheck {
        if (!ASSET_INDEX[assetId]) {
            return { ok: false, reason: 'unknown_tile' };
        }
        if (isMultiCell(assetId)) {
            return this.checkPlaceFootprint(assetId, gx, gy, rot);
        }
        if (!this.tileMap.inBounds(gx, gy)) {
            return { ok: false, reason: 'out_of_bounds' };
        }
        // A single-cell tile may not land inside a building's footprint.
        if (this.tileMap.buildingAt(gx, gy)) {
            return { ok: false, reason: 'occupied' };
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

    /**
     * Probe an atomic footprint placement at anchor `(ax, ay)`:
     * 1. Every rotated-footprint cell must be in bounds (`out_of_bounds`).
     * 2. No covered cell may already belong to a building (`occupied`).
     * 3. All covered columns must share one terrain surface (`not_level`).
     */
    checkPlaceFootprint(
        assetId: string,
        ax: number,
        ay: number,
        rot: Rotation
    ): PlacementCheck {
        const probe: BuildingPlacement = { id: assetId, ax, ay, rot, baseLevel: 0 };
        const cells = buildingCells(probe);
        for (const c of cells) {
            if (!this.tileMap.inBounds(c.gx, c.gy)) {
                return { ok: false, reason: 'out_of_bounds' };
            }
        }
        for (const c of cells) {
            if (this.tileMap.buildingAt(c.gx, c.gy)) {
                return { ok: false, reason: 'occupied' };
            }
        }
        const base0 = this.columnBase(cells[0]!.gx, cells[0]!.gy);
        for (const c of cells) {
            if (this.columnBase(c.gx, c.gy) !== base0) {
                return { ok: false, reason: 'not_level' };
            }
        }
        return { ok: true };
    }

    canPlace(
        assetId: string,
        gx: number,
        gy: number,
        rot: Rotation = 0
    ): boolean {
        return this.checkPlace(assetId, gx, gy, rot).ok;
    }

    place(assetId: string, gx: number, gy: number, rot: Rotation): PlaceResult {
        if (!this.canPlace(assetId, gx, gy, rot)) return null;

        if (isMultiCell(assetId)) {
            const baseLevel = this.columnBase(gx, gy);
            const building: BuildingPlacement = {
                id: assetId,
                ax: gx,
                ay: gy,
                rot,
                baseLevel
            };
            this.tileMap.addBuilding(building);
            return {
                kind: 'building',
                ax: gx,
                ay: gy,
                assetId,
                rot,
                baseLevel
            };
        }

        const top = this.tileMap.topCell(gx, gy);
        if (
            top &&
            !isStackable(top.id) &&
            ASSET_INDEX[assetId]?.category === 'terrain'
        ) {
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

    /**
     * Erase at a cell. If the cell is covered by a building, the whole building
     * is removed (clicking any covered cell erases it as one unit, PRD §5.4);
     * otherwise the top cell of the column is popped. Returns true if anything
     * was removed.
     */
    erase(gx: number, gy: number): boolean {
        const building = this.tileMap.buildingAt(gx, gy);
        if (building) return this.tileMap.removeBuilding(building);
        return this.tileMap.pop(gx, gy) !== null;
    }
}
