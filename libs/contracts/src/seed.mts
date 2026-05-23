/**
 * Deterministic seeded PRNG utilities.
 *
 * `seedFromString` (xmur3) hashes an arbitrary string — e.g. a Spotify track id —
 * into a 32-bit integer; `mulberry32` turns that into a fast PRNG. The same input
 * always yields the same sequence, which is what makes a given song map to a
 * stable world.
 */

export type Rng = () => number;

/** xmur3 string hash → seeded 32-bit integer generator. */
export function xmur3(str: string): () => number {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return function () {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return h >>> 0;
    };
}

/** mulberry32 PRNG: returns a function producing floats in [0, 1). */
export function mulberry32(seed: number): Rng {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Hash a string into a 32-bit seed integer. */
export function seedFromString(str: string): number {
    return xmur3(str)();
}

/** Build a PRNG from a string (hashed) or a numeric seed. */
export function createRng(seed: string | number): Rng {
    const s = typeof seed === 'number' ? seed >>> 0 : seedFromString(seed);
    return mulberry32(s);
}

/** Random integer in `[minInclusive, maxExclusive)`. */
export function randInt(
    rng: Rng,
    minInclusive: number,
    maxExclusive: number
): number {
    return Math.floor(rng() * (maxExclusive - minInclusive)) + minInclusive;
}

/** Pick a random element from a non-empty array. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
    const item = items[Math.floor(rng() * items.length)];
    if (item === undefined) {
        throw new Error('pick() called on an empty array');
    }
    return item;
}
