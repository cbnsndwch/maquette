import { describe, expect, it } from 'vitest';

import {
    Direction,
    opposite,
    solveWfc,
    WfcContradictionError,
    type Rng
} from './wfc.mjs';

/** Tiny deterministic PRNG (mulberry32) so tests don't depend on contracts. */
function makeRng(seed: number): Rng {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * A simple "stripes" ruleset over 3 tiles arranged as a gradient: tile 0 may
 * touch 0 and 1, tile 1 may touch 0/1/2, tile 2 may touch 1/2. This forces
 * neighbours to be within one step of each other.
 */
function gradientAllowed(a: number, b: number): boolean {
    return Math.abs(a - b) <= 1;
}

function checkGradientConstraints(grid: number[][]): boolean {
    const h = grid.length;
    const w = grid[0]!.length;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const v = grid[y]![x]!;
            if (x + 1 < w && Math.abs(v - grid[y]![x + 1]!) > 1) {
                return false;
            }
            if (y + 1 < h && Math.abs(v - grid[y + 1]![x]!) > 1) {
                return false;
            }
        }
    }
    return true;
}

describe('opposite', () => {
    it('is an involution', () => {
        for (const d of [
            Direction.East,
            Direction.West,
            Direction.South,
            Direction.North
        ]) {
            expect(opposite(opposite(d))).toBe(d);
        }
    });
});

describe('solveWfc', () => {
    it('fills a grid of the requested shape', () => {
        const result = solveWfc({
            width: 10,
            height: 7,
            tileCount: 3,
            weights: [1, 1, 1],
            allowed: gradientAllowed,
            rng: makeRng(1)
        });
        expect(result.grid).toHaveLength(7);
        for (const row of result.grid) {
            expect(row).toHaveLength(10);
            for (const v of row) {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThan(3);
            }
        }
    });

    it('respects adjacency constraints', () => {
        const result = solveWfc({
            width: 14,
            height: 14,
            tileCount: 3,
            weights: [1, 2, 1],
            allowed: gradientAllowed,
            rng: makeRng(42)
        });
        expect(checkGradientConstraints(result.grid)).toBe(true);
    });

    it('is deterministic for the same seed', () => {
        const opts = {
            width: 14,
            height: 14,
            tileCount: 3,
            weights: [1, 1, 1] as const,
            allowed: gradientAllowed
        };
        const a = solveWfc({ ...opts, rng: makeRng(7) });
        const b = solveWfc({ ...opts, rng: makeRng(7) });
        expect(a.grid).toEqual(b.grid);
    });

    it('produces different output for different seeds', () => {
        const opts = {
            width: 14,
            height: 14,
            tileCount: 3,
            weights: [1, 1, 1] as const,
            allowed: gradientAllowed
        };
        const a = solveWfc({ ...opts, rng: makeRng(1) });
        const b = solveWfc({ ...opts, rng: makeRng(2) });
        expect(a.grid).not.toEqual(b.grid);
    });

    it('honours a zero weight by never placing that tile', () => {
        const result = solveWfc({
            width: 8,
            height: 8,
            tileCount: 3,
            weights: [1, 0, 1],
            allowed: gradientAllowed,
            rng: makeRng(3)
        });
        const flat = result.grid.flat();
        expect(flat).not.toContain(1);
    });

    it('throws when the ruleset is unsatisfiable', () => {
        // Two tiles that may never touch each other and may not touch
        // themselves: no 2+ cell grid can be filled.
        const incompatible = () => false;
        expect(() =>
            solveWfc({
                width: 4,
                height: 4,
                tileCount: 2,
                weights: [1, 1],
                allowed: incompatible,
                rng: makeRng(1),
                maxRestarts: 2
            })
        ).toThrow(WfcContradictionError);
    });

    it('honours initial boundary constraints', () => {
        // Pin the entire border to tile 0; with the gradient ruleset the
        // interior may only climb to 1 next to the border.
        const w = 9;
        const h = 9;
        const result = solveWfc({
            width: w,
            height: h,
            tileCount: 3,
            weights: [1, 1, 1],
            allowed: gradientAllowed,
            rng: makeRng(11),
            initial: (x, y) =>
                x === 0 || y === 0 || x === w - 1 || y === h - 1
                    ? [0]
                    : undefined
        });
        for (let x = 0; x < w; x++) {
            expect(result.grid[0]![x]).toBe(0);
            expect(result.grid[h - 1]![x]).toBe(0);
        }
        for (let y = 0; y < h; y++) {
            expect(result.grid[y]![0]).toBe(0);
            expect(result.grid[y]![w - 1]).toBe(0);
        }
        expect(checkGradientConstraints(result.grid)).toBe(true);
    });

    it('throws on unsatisfiable initial constraints', () => {
        // Adjacent pinned cells demanding tiles that may never touch.
        expect(() =>
            solveWfc({
                width: 2,
                height: 1,
                tileCount: 3,
                weights: [1, 1, 1],
                allowed: gradientAllowed,
                rng: makeRng(1),
                initial: (x, _y) => (x === 0 ? [0] : [2])
            })
        ).toThrow(WfcContradictionError);
    });

    it('solves a single-cell grid trivially', () => {
        const result = solveWfc({
            width: 1,
            height: 1,
            tileCount: 3,
            weights: [1, 1, 1],
            allowed: gradientAllowed,
            rng: makeRng(5)
        });
        expect(result.grid).toEqual([[expect.any(Number)]]);
        expect(result.restarts).toBe(0);
    });
});
