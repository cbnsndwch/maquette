import { TILE_TYPES } from '@cbnsndwch/contracts';

/**
 * The Mykonos tile catalog: the domain knowledge that turns the generic WFC
 * engine into a sun-bleached Cycladic island. WorldSpec tile ids are biome-local
 * strings; the Mykonos vocabulary is `TILE_TYPES`, narrowed here to a union so
 * the lookup tables below stay total. The {@link Biome} wiring lives in
 * `biomes/mykonos.mts`.
 */

/** The Mykonos biome's tile vocabulary. */
export type MykonosTile = (typeof TILE_TYPES)[number];

/**
 * Elevation/role class per tile. Adjacency is gradient-based: two tiles may
 * touch only if their classes differ by at most one. This makes the sea ring
 * the island, beaches separate sea from land, and buildings rise on rock toward
 * the interior — without any explicit radial shaping.
 */
export const TILE_CLASS: Record<MykonosTile, number> = {
    water: 0,
    sand: 1,
    grass: 2,
    path: 2,
    plaza: 2,
    rock: 3,
    stairs: 3,
    wall: 3,
    rooftop: 4,
    dome: 4
};

/**
 * Baseline relative frequency per tile before audio-feature modulation. Water
 * is deliberately rare: it is already forced around the border, so a low weight
 * keeps the interior dry land rather than letting the sea flood inward (water is
 * self-compatible, so a high weight drowns the island).
 */
export const BASE_WEIGHTS: Record<MykonosTile, number> = {
    water: 0.4,
    sand: 1.0,
    grass: 1.6,
    path: 1.6,
    plaza: 3.2,
    rock: 1.0,
    stairs: 0.4,
    wall: 1.6,
    rooftop: 1,
    dome: 0.5
};

/** Normalized terrain height (0..1) each tile type extrudes to. */
export const TILE_HEIGHT: Record<MykonosTile, number> = {
    water: 0.05,
    sand: 0.18,
    grass: 0.34,
    path: 0.36,
    plaza: 0.4,
    rock: 0.55,
    stairs: 0.5,
    wall: 0.7,
    rooftop: 0.85,
    dome: 0.92
};

/**
 * Palette families keyed by time of day. Slots are positional and must keep
 * their meaning so the renderer's tile→palette mapping stays valid:
 * 0 whitewash · 1 accent · 2 terracotta · 3 olive · 4 dust/rock · 5 sand ·
 * 6 sea · 7 sky.
 */
export const PALETTES = {
    day: [
        '#f4f1ea',
        '#1e63b5',
        '#c66b3d',
        '#6b7a3a',
        '#cdbfa3',
        '#e8d9b5',
        '#2f9fb5',
        '#9fd4e0'
    ],
    dawn: [
        '#f7efe6',
        '#3a6ea5',
        '#d98a5b',
        '#7c8a4e',
        '#d8c6a8',
        '#f0ddb8',
        '#5bb0c0',
        '#f3c9b0'
    ],
    dusk: [
        '#f3e3d0',
        '#9b4f6b',
        '#d2602f',
        '#6f6a3a',
        '#c9a98a',
        '#e6c08a',
        '#3f7e96',
        '#e7a07a'
    ],
    night: [
        '#cdd6e6',
        '#2a3f7a',
        '#8a4a3a',
        '#3f5a4a',
        '#5a6478',
        '#7a86a0',
        '#1c4a66',
        '#2a3b66'
    ]
} as const satisfies Record<string, readonly string[]>;
