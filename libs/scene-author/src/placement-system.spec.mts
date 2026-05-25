import { beforeEach, describe, expect, it } from 'vitest';

import { setCatalog } from './catalog.mjs';
import { PlacementSystem } from './placement-system.mjs';
import { parseSceneDocument, toSceneDocument } from './scene-document.mjs';
import { TileMap } from './tile-map.mjs';

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

    it('flags a document whose column count disagrees with its dimensions', () => {
        const parsed = parseSceneDocument({
            width: 3,
            height: 3,
            terrain: [[]]
        });
        expect(parsed.ok).toBe(false);
    });
});
