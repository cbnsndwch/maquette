/**
 * A small, dependency-free 2D tiled Wave Function Collapse solver.
 *
 * Clean-room implementation of the classic "SimpleTiled" WFC algorithm
 * (lowest-entropy observation, arc-consistency propagation, restart-based
 * backtracking), in the spirit of LingDong-/ndwfc (MIT). It is deliberately
 * domain-agnostic: tiles are integer ids and adjacency is supplied as a
 * callback, so the same engine can lay out a Mykonos island, a dungeon, or a
 * texture. Randomness is injected as an `Rng` so a given seed always yields
 * the same grid.
 */

/** A pseudo-random number generator returning floats in `[0, 1)`. */
export type Rng = () => number;

/**
 * Neighbor directions on the grid. The numeric values are stable and used to
 * index adjacency tables, so do not reorder them.
 */
export const enum Direction {
    /** +x */ East = 0,
    /** -x */ West = 1,
    /** +y */ South = 2,
    /** -y */ North = 3
}

export const DIRECTIONS: readonly Direction[] = [
    Direction.East,
    Direction.West,
    Direction.South,
    Direction.North
];

const DELTA: Record<Direction, readonly [number, number]> = {
    [Direction.East]: [1, 0],
    [Direction.West]: [-1, 0],
    [Direction.South]: [0, 1],
    [Direction.North]: [0, -1]
};

/** The direction facing back the way you came. */
export function opposite(dir: Direction): Direction {
    switch (dir) {
        case Direction.East:
            return Direction.West;
        case Direction.West:
            return Direction.East;
        case Direction.South:
            return Direction.North;
        case Direction.North:
            return Direction.South;
    }
}

export interface WfcOptions {
    width: number;
    height: number;
    /** Number of distinct tile kinds. Tiles are ids `0 .. tileCount - 1`. */
    tileCount: number;
    /**
     * Relative weight per tile id; higher means more frequent. Must be length
     * `tileCount` and non-negative. A weight of 0 excludes the tile entirely.
     */
    weights: readonly number[];
    /**
     * Adjacency predicate: may tile `b` sit immediately to the `direction` of
     * tile `a`? Should be consistent under reversal — i.e.
     * `allowed(a, b, d) === allowed(b, a, opposite(d))` — otherwise propagation
     * may behave asymmetrically. The engine does not assume symmetry, so an
     * intentionally directional ruleset is supported.
     */
    allowed: (a: number, b: number, direction: Direction) => boolean;
    rng: Rng;
    /**
     * Optional boundary/seed conditions. For a given cell, return the subset of
     * tile ids it is allowed to start with (e.g. force the border to water), or
     * `undefined`/`null` to leave it unconstrained. Constraints are propagated
     * before the first observation, so they shape the whole solve. They are
     * fixed (not rng-driven), so an unsatisfiable constraint set always throws.
     */
    initial?: (x: number, y: number) => readonly number[] | null | undefined;
    /**
     * How many times to restart from scratch after hitting a contradiction
     * before giving up. Each restart consumes more of the `rng` stream, so it
     * explores a different path while staying deterministic. Default 12.
     */
    maxRestarts?: number;
}

export interface WfcResult {
    /** Collapsed tile id per cell, row-major: `grid[y][x]`. */
    grid: number[][];
    /** How many restarts were needed (0 means it solved on the first try). */
    restarts: number;
}

export class WfcContradictionError extends Error {
    constructor(message = 'WFC could not solve the grid within maxRestarts') {
        super(message);
        this.name = 'WfcContradictionError';
    }
}

/**
 * Precomputed compatibility tables. `compat[dir][a]` is a mask over tile ids:
 * `compat[dir][a][b] === 1` iff tile `b` may sit to the `direction` of `a`.
 */
function buildCompat(
    tileCount: number,
    allowed: WfcOptions['allowed']
): Uint8Array[][] {
    const compat: Uint8Array[][] = [];
    for (const dir of DIRECTIONS) {
        const perTile: Uint8Array[] = [];
        for (let a = 0; a < tileCount; a++) {
            const mask = new Uint8Array(tileCount);
            for (let b = 0; b < tileCount; b++) {
                mask[b] = allowed(a, b, dir) ? 1 : 0;
            }
            perTile.push(mask);
        }
        compat[dir] = perTile;
    }
    return compat;
}

interface Cell {
    /** Possibility mask over tile ids; 1 = still possible. */
    domain: Uint8Array;
    /** Number of 1s in `domain`, cached. */
    count: number;
}

/**
 * Run Wave Function Collapse and return a fully collapsed grid.
 *
 * Throws {@link WfcContradictionError} if no solution is found within
 * `maxRestarts`. For grids well below the failure regime (e.g. 14×14) with a
 * sane ruleset this effectively never happens.
 */
export function solveWfc(options: WfcOptions): WfcResult {
    const {
        width,
        height,
        tileCount,
        weights,
        allowed,
        rng,
        initial,
        maxRestarts = 12
    } = options;

    if (width <= 0 || height <= 0) {
        throw new Error('WFC grid dimensions must be positive');
    }
    if (weights.length !== tileCount) {
        throw new Error('weights length must equal tileCount');
    }

    const compat = buildCompat(tileCount, allowed);
    const idx = (x: number, y: number) => y * width + x;

    // Precompute log weights for entropy; guard against zero/negative.
    const safeWeights = weights.map(w => (w > 0 ? w : 0));

    for (let restart = 0; restart <= maxRestarts; restart++) {
        const cells: Cell[] = [];
        const seeded: number[] = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const allow = initial?.(x, y);
                const allowSet = allow == null ? null : new Set(allow);
                const domain = new Uint8Array(tileCount);
                let count = 0;
                for (let t = 0; t < tileCount; t++) {
                    if (safeWeights[t]! > 0 && (!allowSet || allowSet.has(t))) {
                        domain[t] = 1;
                        count++;
                    }
                }
                cells.push({ domain, count });
                if (allowSet) {
                    seeded.push(idx(x, y));
                }
            }
        }

        // Enforce the boundary/seed conditions before observing anything.
        let consistent = true;
        for (const i of seeded) {
            if (cells[i]!.count === 0) {
                consistent = false;
                break;
            }
            if (!propagate(cells, i, width, height, tileCount, compat, idx)) {
                consistent = false;
                break;
            }
        }
        if (!consistent) {
            // Fixed constraints can't be salvaged by retrying with new rng.
            throw new WfcContradictionError(
                'WFC initial constraints are unsatisfiable'
            );
        }

        const solved = collapse(
            cells,
            width,
            height,
            tileCount,
            safeWeights,
            compat,
            rng,
            idx
        );

        if (solved) {
            const grid: number[][] = [];
            for (let y = 0; y < height; y++) {
                const row: number[] = [];
                for (let x = 0; x < width; x++) {
                    row.push(collapsedTile(cells[idx(x, y)]!));
                }
                grid.push(row);
            }
            return { grid, restarts: restart };
        }
    }

    throw new WfcContradictionError();
}

function collapsedTile(cell: Cell): number {
    for (let t = 0; t < cell.domain.length; t++) {
        if (cell.domain[t] === 1) {
            return t;
        }
    }
    return 0;
}

/** Returns true on full collapse, false on contradiction. */
function collapse(
    cells: Cell[],
    width: number,
    height: number,
    tileCount: number,
    weights: readonly number[],
    compat: Uint8Array[][],
    rng: Rng,
    idx: (x: number, y: number) => number
): boolean {
    for (;;) {
        const cellIndex = pickLowestEntropy(cells, weights, rng);
        if (cellIndex === -1) {
            return true; // everything collapsed
        }

        const tile = chooseTile(cells[cellIndex]!, weights, rng);
        const cell = cells[cellIndex]!;
        cell.domain.fill(0);
        cell.domain[tile] = 1;
        cell.count = 1;

        if (
            !propagate(cells, cellIndex, width, height, tileCount, compat, idx)
        ) {
            return false; // contradiction; caller restarts
        }
    }
}

/** Index of the uncollapsed cell with the least Shannon entropy, or -1. */
function pickLowestEntropy(
    cells: Cell[],
    weights: readonly number[],
    rng: Rng
): number {
    let best = -1;
    let bestEntropy = Number.POSITIVE_INFINITY;

    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i]!;
        if (cell.count <= 1) {
            continue;
        }

        let sum = 0;
        let sumLog = 0;
        for (let t = 0; t < cell.domain.length; t++) {
            if (cell.domain[t] === 1) {
                const w = weights[t]!;
                sum += w;
                sumLog += w * Math.log(w);
            }
        }
        // Shannon entropy of the weighted distribution, plus a tiny random
        // jitter so ties are broken deterministically by the rng stream.
        const entropy = Math.log(sum) - sumLog / sum + rng() * 1e-6;
        if (entropy < bestEntropy) {
            bestEntropy = entropy;
            best = i;
        }
    }

    return best;
}

/** Weighted-random choice among a cell's still-possible tiles. */
function chooseTile(cell: Cell, weights: readonly number[], rng: Rng): number {
    let total = 0;
    for (let t = 0; t < cell.domain.length; t++) {
        if (cell.domain[t] === 1) {
            total += weights[t]!;
        }
    }

    let r = rng() * total;
    for (let t = 0; t < cell.domain.length; t++) {
        if (cell.domain[t] === 1) {
            r -= weights[t]!;
            if (r <= 0) {
                return t;
            }
        }
    }

    // Floating-point fallthrough: return the last possible tile.
    for (let t = cell.domain.length - 1; t >= 0; t--) {
        if (cell.domain[t] === 1) {
            return t;
        }
    }
    return 0;
}

/**
 * Arc-consistency propagation from a just-changed cell. Returns false if any
 * cell's domain is wiped out (a contradiction).
 */
function propagate(
    cells: Cell[],
    start: number,
    width: number,
    height: number,
    tileCount: number,
    compat: Uint8Array[][],
    idx: (x: number, y: number) => number
): boolean {
    const stack: number[] = [start];

    while (stack.length > 0) {
        const current = stack.pop()!;
        const cx = current % width;
        const cy = Math.floor(current / width);
        const cell = cells[current]!;

        for (const dir of DIRECTIONS) {
            const [dx, dy] = DELTA[dir];
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
                continue;
            }

            const neighbor = cells[idx(nx, ny)]!;
            if (neighbor.count === 0) {
                return false;
            }

            const compatDir = compat[dir]!;

            // A neighbor tile `b` survives only if some tile `a` still possible
            // in `cell` permits `b` to its `dir`.
            let removed = false;
            for (let b = 0; b < tileCount; b++) {
                if (neighbor.domain[b] === 0) {
                    continue;
                }
                let supported = false;
                for (let a = 0; a < tileCount; a++) {
                    if (cell.domain[a] === 1 && compatDir[a]![b] === 1) {
                        supported = true;
                        break;
                    }
                }
                if (!supported) {
                    neighbor.domain[b] = 0;
                    neighbor.count--;
                    removed = true;
                }
            }

            if (neighbor.count === 0) {
                return false;
            }
            if (removed) {
                stack.push(idx(nx, ny));
            }
        }
    }

    return true;
}
