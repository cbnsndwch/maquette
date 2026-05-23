import { z } from 'zod';

/**
 * WorldSpec — the serializable description of a single generated world.
 *
 * It is the central contract of the pipeline: a generator (deterministic WFC or
 * an LLM) produces a `WorldSpec`, and a renderer turns it into a scene. Because
 * it is plain, validatable data, worlds can be cached per track, serialized to
 * share/replay, and rendered to any target.
 */

/** Side length of the (square) world grid, in tiles. */
export const GRID_SIZE = 14;

/** Number of colors in a world palette. */
export const PALETTE_SIZE = 8;

/** Bump when the schema changes in a backwards-incompatible way. */
export const WORLD_SPEC_VERSION = 1;

export const ROTATIONS = [0, 90, 180, 270] as const;
export const rotationSchema = z.union([
    z.literal(0),
    z.literal(90),
    z.literal(180),
    z.literal(270)
]);
export type Rotation = (typeof ROTATIONS)[number];

/**
 * Tile and prop ids in a WorldSpec are **biome-local strings** — each biome owns
 * its own vocabulary — so the schema accepts any string. The constants below are
 * the Mykonos biome's default set, kept here for convenience.
 */
export const TILE_TYPES = [
    'water',
    'sand',
    'grass',
    'rock',
    'plaza',
    'path',
    'wall',
    'rooftop',
    'dome',
    'stairs'
] as const;
export const tileTypeSchema = z.string();
export type TileType = string;

export const PROP_TYPES = [
    'olive-tree',
    'cypress',
    'bench',
    'pot',
    'lamp',
    'well',
    'boat',
    'windmill'
] as const;
export const propTypeSchema = z.string();
export type PropType = string;

export const WEATHER = ['clear', 'cloudy', 'rain', 'fog'] as const;
export const weatherSchema = z.enum(WEATHER);
export type Weather = (typeof WEATHER)[number];

export const TIMES_OF_DAY = ['dawn', 'day', 'dusk', 'night'] as const;
export const timeOfDaySchema = z.enum(TIMES_OF_DAY);
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export const PARADIGMS = ['wfc', 'llm'] as const;
export const paradigmSchema = z.enum(PARADIGMS);
export type Paradigm = (typeof PARADIGMS)[number];

/** A 6-digit hex color, with or without a leading `#`. */
export const hexColorSchema = z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/, 'expected a 6-digit hex color');

/** A square grid of exactly `GRID_SIZE` × `GRID_SIZE` cells. */
function fixedGrid<T extends z.ZodTypeAny>(cell: T) {
    return z.array(z.array(cell).length(GRID_SIZE)).length(GRID_SIZE);
}

export const tileSchema = z.object({
    type: tileTypeSchema,
    rotation: rotationSchema
});
export type Tile = z.infer<typeof tileSchema>;

export const propSchema = z.object({
    type: propTypeSchema,
    /** Grid-space position (may be fractional for sub-tile placement). */
    x: z.number(),
    y: z.number(),
    scale: z.number().positive().default(1),
    /** Free rotation around the up axis, in degrees. */
    rotation: z.number().default(0)
});
export type Prop = z.infer<typeof propSchema>;

/**
 * A multi-cell building placed on the grid. Unlike a {@link Prop} (a single
 * decoration), a structure spans a square `footprint` of tiles and is rendered
 * as one composite voxel asset keyed by `type` (e.g. 'two-story', 'chapel').
 */
export const structureSchema = z.object({
    type: z.string(),
    /** Anchor cell: the min-x/min-y corner of the footprint. */
    x: z.number().int(),
    y: z.number().int(),
    /** Footprint side length in tiles (square). */
    footprint: z.number().int().positive().default(1),
    rotation: rotationSchema.default(0)
});
export type Structure = z.infer<typeof structureSchema>;

export const postFxSchema = z.object({
    /** Kuwahara painterly pass. */
    kuwahara: z.boolean().default(false),
    /** Bayer ordered-dither pass. */
    dither: z.boolean().default(false),
    /** Number of colors to quantize to; 0 disables quantization. */
    paletteQuantize: z.number().int().min(0).default(0),
    /** Cel-shaded outline pass. */
    toonOutline: z.boolean().default(false)
});
export type PostFx = z.infer<typeof postFxSchema>;

export const worldSpecSchema = z.object({
    version: z.literal(WORLD_SPEC_VERSION),
    /** The seed (typically a track id) this world was generated from. */
    seed: z.string(),
    paradigm: paradigmSchema,
    /** Which biome's vocabulary/look this world uses (e.g. 'mykonos'). */
    biome: z.string(),
    palette: z.array(hexColorSchema).length(PALETTE_SIZE),
    terrain: z.object({
        heightmap: fixedGrid(z.number())
    }),
    tiles: fixedGrid(tileSchema),
    props: z.array(propSchema),
    /** Multi-cell composite buildings. Empty for biomes that don't place any. */
    structures: z.array(structureSchema).default([]),
    weather: weatherSchema,
    timeOfDay: timeOfDaySchema,
    postFx: postFxSchema
});

/** The fully-resolved WorldSpec type (defaults applied). */
export type WorldSpec = z.infer<typeof worldSpecSchema>;

/** Parse and validate unknown input into a WorldSpec, throwing on failure. */
export function validateWorldSpec(input: unknown): WorldSpec {
    return worldSpecSchema.parse(input);
}

/** Non-throwing variant of {@link validateWorldSpec}. */
export function safeValidateWorldSpec(input: unknown) {
    return worldSpecSchema.safeParse(input);
}
