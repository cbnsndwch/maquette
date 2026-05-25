import { beforeEach, describe, expect, it } from 'vitest';

import { setCatalog } from './catalog.mjs';
import { PlacementSystem } from './placement-system.mjs';
import { parseSceneDocument, toSceneDocument } from './scene-document.mjs';
import { buildingCells, TileMap } from './tile-map.mjs';

beforeEach(() => {
    setCatalog([
        {
            id: 'grass',
            name: 'grass',
            category: 'terrain',
            file: '/voxels/terrain/grass.vox',
            stackable: true
        },
        {
            id: 'sea_wall',
            name: 'sea wall',
            category: 'terrain',
            file: '/voxels/terrain/sea_wall.vox',
            stackable: false
        },
        {
            id: 'boulder',
            name: 'boulder',
            category: 'nature',
            file: '/voxels/nature/boulder.vox',
            stackable: false
        },
        {
            id: 'house_2x2',
            name: 'house',
            category: 'buildings',
            file: '/voxels/terrain/house_2x2.vox',
            stackable: false,
            footprint: [2, 2]
        },
        {
            id: 'bridge_2x1',
            name: 'bridge',
            category: 'buildings',
            file: '/voxels/terrain/bridge_2x1.vox',
            stackable: false,
            footprint: [2, 1]
        }
    ]);
});

describe('PlacementSystem.checkPlace', () => {
    it('rejects unknown tiles', () => {
        const sys = new PlacementSystem(new TileMap(4, 4));
        expect(sys.checkPlace('nope', 0, 0)).toEqual({
            ok: false,
            reason: 'unknown_tile'
        });
    });

    it('rejects out-of-bounds columns', () => {
        const sys = new PlacementSystem(new TileMap(4, 4));
        expect(sys.checkPlace('grass', 9, 9)).toEqual({
            ok: false,
            reason: 'out_of_bounds'
        });
    });

    it('allows starting a column and stacking on stackable tops', () => {
        const map = new TileMap(4, 4);
        const sys = new PlacementSystem(map);
        expect(sys.checkPlace('grass', 1, 1)).toEqual({ ok: true });
        sys.place('grass', 1, 1, 0);
        expect(sys.checkPlace('grass', 1, 1)).toEqual({ ok: true });
    });

    it('rejects non-terrain tiles on a non-stackable top', () => {
        const map = new TileMap(4, 4);
        const sys = new PlacementSystem(map);
        sys.place('sea_wall', 2, 2, 0);
        expect(sys.checkPlace('boulder', 2, 2)).toEqual({
            ok: false,
            reason: 'not_stackable'
        });
    });

    it('allows terrain tiles on a non-stackable top (replaces topmost terrain)', () => {
        const map = new TileMap(4, 4);
        const sys = new PlacementSystem(map);
        sys.place('grass', 2, 2, 0);
        sys.place('boulder', 2, 2, 0);
        expect(sys.checkPlace('sea_wall', 2, 2)).toEqual({ ok: true });
        sys.place('sea_wall', 2, 2, 0);
        const stack = map.getStack(2, 2);
        expect(stack).toHaveLength(2);
        expect(stack[0]!.id).toBe('sea_wall');
        expect(stack[1]!.id).toBe('boulder');
    });
});

describe('PlacementSystem footprint (buildings)', () => {
    const cellSet = (cells: { gx: number; gy: number }[]): Set<string> =>
        new Set(cells.map(c => `${c.gx},${c.gy}`));

    it('places a 2×2 building atomically and indexes every covered cell', () => {
        const map = new TileMap(6, 6);
        const sys = new PlacementSystem(map);
        const result = sys.place('house_2x2', 1, 1, 0);
        expect(result?.kind).toBe('building');
        expect(map.getBuildings()).toHaveLength(1);
        const covered = ['1,1', '2,1', '1,2', '2,2'];
        for (const k of covered) {
            const [gx, gy] = k.split(',').map(Number) as [number, number];
            expect(map.buildingAt(gx, gy)).toBe(map.getBuildings()[0]);
        }
        // A neighbour just outside the footprint is free.
        expect(map.buildingAt(3, 1)).toBeNull();
    });

    it('rejects a footprint hanging off the grid edge', () => {
        const map = new TileMap(4, 4);
        const sys = new PlacementSystem(map);
        expect(sys.checkPlace('house_2x2', 3, 3, 0)).toEqual({
            ok: false,
            reason: 'out_of_bounds'
        });
    });

    it('rejects a footprint overlapping another building', () => {
        const map = new TileMap(6, 6);
        const sys = new PlacementSystem(map);
        sys.place('house_2x2', 0, 0, 0);
        expect(sys.checkPlace('house_2x2', 1, 1, 0)).toEqual({
            ok: false,
            reason: 'occupied'
        });
    });

    it('rejects a footprint over an unlevel surface', () => {
        const map = new TileMap(6, 6);
        const sys = new PlacementSystem(map);
        sys.place('grass', 0, 0, 0); // one covered cell raised, the rest empty
        expect(sys.checkPlace('house_2x2', 0, 0, 0)).toEqual({
            ok: false,
            reason: 'not_level'
        });
        // Level the whole footprint → now it places.
        sys.place('grass', 1, 0, 0);
        sys.place('grass', 0, 1, 0);
        sys.place('grass', 1, 1, 0);
        expect(sys.checkPlace('house_2x2', 0, 0, 0)).toEqual({ ok: true });
    });

    it('rejects a 1×1 tile dropped into a building footprint', () => {
        const map = new TileMap(6, 6);
        const sys = new PlacementSystem(map);
        sys.place('house_2x2', 1, 1, 0);
        expect(sys.checkPlace('grass', 2, 2)).toEqual({
            ok: false,
            reason: 'occupied'
        });
    });

    it('erases the whole building from any covered cell', () => {
        const map = new TileMap(6, 6);
        const sys = new PlacementSystem(map);
        sys.place('house_2x2', 1, 1, 0);
        expect(sys.erase(2, 2)).toBe(true); // not the anchor
        expect(map.getBuildings()).toHaveLength(0);
        expect(map.buildingAt(1, 1)).toBeNull();
    });

    it('rotates a non-square 2×1 footprint into the right cells', () => {
        const map = new TileMap(6, 6);
        const sys = new PlacementSystem(map);
        sys.place('bridge_2x1', 1, 1, 0);
        expect(cellSet(map.getBuildings().flatMap(buildingCells))).toEqual(
            cellSet([
                { gx: 1, gy: 1 },
                { gx: 2, gy: 1 }
            ])
        );
        sys.erase(1, 1);
        sys.place('bridge_2x1', 1, 1, 1); // 90° → 1×2
        expect(cellSet(map.getBuildings().flatMap(buildingCells))).toEqual(
            cellSet([
                { gx: 1, gy: 1 },
                { gx: 1, gy: 2 }
            ])
        );
    });
});

describe('scene document round-trip', () => {
    it('serializes to a valid document that reloads identically', () => {
        const map = new TileMap(3, 3);
        const sys = new PlacementSystem(map);
        sys.place('grass', 0, 0, 0);
        sys.place('grass', 0, 0, 1);
        sys.place('sea_wall', 2, 1, 2);

        const doc = toSceneDocument(map);
        const parsed = parseSceneDocument(doc);
        expect(parsed.ok).toBe(true);

        const reloaded = new TileMap(3, 3);
        expect(reloaded.load(doc)).toBe(true);
        expect(reloaded.serialize()).toEqual(doc);
    });

    it('round-trips a scene that contains a building', () => {
        const map = new TileMap(6, 6);
        const sys = new PlacementSystem(map);
        sys.place('grass', 0, 0, 0);
        sys.place('house_2x2', 2, 2, 1);

        const doc = toSceneDocument(map);
        expect(doc.buildings).toHaveLength(1);
        expect(parseSceneDocument(doc).ok).toBe(true);

        const reloaded = new TileMap(6, 6);
        expect(reloaded.load(doc)).toBe(true);
        expect(reloaded.serialize()).toEqual(doc);
        // Occupancy is rebuilt on load.
        expect(reloaded.buildingAt(3, 3)).not.toBeNull();
    });

    it('flags a document whose column count disagrees with its dimensions', () => {
        const parsed = parseSceneDocument({
            width: 3,
            height: 3,
            terrain: [[]]
        });
        expect(parsed.ok).toBe(false);
    });
});
