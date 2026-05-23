import {
    GRID_SIZE,
    ROTATIONS,
    WORLD_SPEC_VERSION,
    audioFeaturesSchema,
    createRng,
    pick,
    type AudioFeatures,
    type Paradigm,
    type PostFx,
    type Prop,
    type Rng,
    type Tile,
    type TimeOfDay,
    type Weather,
    type WorldSpec
} from '@cbnsndwch/contracts';
import { solveWfc } from '@cbnsndwch/wfc';

import { featuresFromSeed } from './derive.mjs';

/**
 * A biome is a parameterized world recipe. The current Mykonos voxel world is
 * biome #1; beach, cyberpunk, solarpunk, etc. are sibling modules implementing
 * this same (generation-side) interface. A track's vibe + origin select a biome
 * (or a shortlist), and the generic {@link generateWorld} solver below turns the
 * chosen biome into a {@link WorldSpec}.
 *
 * This is the generation half only — rendering (tile colors, prop meshes) lives
 * with the renderers, keyed by `Biome.id`, so generation stays free of `three`.
 */

export interface BiomeTile {
    /** Biome-local tile id, written into `WorldSpec.tiles[].type`. */
    id: string;
    /**
     * Adjacency class. The default gradient rule lets two tiles touch only if
     * their classes differ by at most one, which produces coherent bands
     * (sea → beach → land → built) without explicit shaping.
     */
    cls: number;
    /** Normalized terrain height (0..1) this tile extrudes to. */
    height: number;
}

export interface BiomeKnobs {
    /** WFC weight per tile, in `Biome.tiles` order. */
    weights: number[];
    palette: string[];
    timeOfDay: TimeOfDay;
    weather: Weather;
    /** Base probability a buildable tile spawns a prop, 0..1. */
    propDensity: number;
}

export interface Biome {
    id: string;
    /** Tile vocabulary; the array index is the WFC tile id. */
    tiles: readonly BiomeTile[];
    /** Tile id forced around the world border (e.g. 'water', 'canal'). */
    borderTileId: string;
    /** May tile `b` sit next to tile `a`? See {@link gradientAdjacency}. */
    allowed(a: BiomeTile, b: BiomeTile): boolean;
    /** Map audio features → generation knobs (weights/palette/mood/density). */
    resolveKnobs(features: AudioFeatures, rng: Rng): BiomeKnobs;
    /** Scatter props over the resolved tile-id grid. */
    placeProps(tileIds: string[][], density: number, rng: Rng): Prop[];
}

/** The classic gradient adjacency rule: classes within `maxDelta` may touch. */
export function gradientAdjacency(
    maxDelta = 1
): (a: BiomeTile, b: BiomeTile) => boolean {
    return (a, b) => Math.abs(a.cls - b.cls) <= maxDelta;
}

export interface GenerateOptions {
    /** Track audio features; omitted fields are filled from the seed. */
    features?: Partial<AudioFeatures>;
    /** Post-processing toggles to embed in the spec. Defaults to all off. */
    postFx?: Partial<PostFx>;
    /** Creative-direction overrides (used by the LLM path). */
    palette?: string[];
    timeOfDay?: TimeOfDay;
    weather?: Weather;
    paradigm?: Paradigm;
}

const DEFAULT_POST_FX: PostFx = {
    kuwahara: false,
    dither: false,
    paletteQuantize: 0,
    toonOutline: false
};

function resolveFeatures(
    seed: string,
    provided?: Partial<AudioFeatures>
): AudioFeatures {
    return audioFeaturesSchema.parse({
        ...featuresFromSeed(seed),
        ...provided
    });
}

/**
 * Generate a {@link WorldSpec} for a track using the given biome. The same
 * `(seed, biome, features)` always yields the same world.
 */
export function generateWorld(
    seed: string,
    biome: Biome,
    options: GenerateOptions = {}
): WorldSpec {
    const features = resolveFeatures(seed, options.features);
    const layoutRng = createRng(`${seed}:wfc`);
    const decorRng = createRng(`${seed}:decor`);
    const knobs = biome.resolveKnobs(features, decorRng);

    const tiles = biome.tiles;
    const borderIdx = tiles.findIndex(t => t.id === biome.borderTileId);

    const { grid } = solveWfc({
        width: GRID_SIZE,
        height: GRID_SIZE,
        tileCount: tiles.length,
        weights: knobs.weights,
        rng: layoutRng,
        allowed: (a, b) => biome.allowed(tiles[a]!, tiles[b]!),
        // Ring the world in its border tile so land emerges from the interior.
        initial: (x, y) =>
            borderIdx >= 0 &&
            (x === 0 || y === 0 || x === GRID_SIZE - 1 || y === GRID_SIZE - 1)
                ? [borderIdx]
                : undefined
    });

    const tileIds: string[][] = grid.map(row => row.map(i => tiles[i]!.id));
    const heightById = new Map(tiles.map(t => [t.id, t.height]));

    const worldTiles: Tile[][] = tileIds.map(row =>
        row.map(id => ({ type: id, rotation: pick(decorRng, ROTATIONS) }))
    );

    const heightmap: number[][] = tileIds.map(row =>
        row.map(id => {
            const base = heightById.get(id) ?? 0;
            const jitter = (decorRng() - 0.5) * 0.06;
            return Number(Math.max(0, Math.min(1, base + jitter)).toFixed(3));
        })
    );

    const props = biome.placeProps(tileIds, knobs.propDensity, decorRng);

    return {
        version: WORLD_SPEC_VERSION,
        seed,
        paradigm: options.paradigm ?? 'wfc',
        biome: biome.id,
        palette: options.palette ?? knobs.palette,
        terrain: { heightmap },
        tiles: worldTiles,
        props,
        weather: options.weather ?? knobs.weather,
        timeOfDay: options.timeOfDay ?? knobs.timeOfDay,
        postFx: { ...DEFAULT_POST_FX, ...options.postFx }
    };
}
