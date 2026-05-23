import type { WorldSpec } from '@cbnsndwch/contracts';

import { generateWorld, type GenerateOptions } from './biome.mjs';
import { getBiome } from './biome-registry.mjs';

/**
 * The deterministic generation path (research Stage 2). Now biome-driven: it
 * resolves a biome (default Mykonos) and runs the generic WFC generator. Kept as
 * a named entry point for the WFC paradigm; `generateWorld` is the lower-level
 * biome-explicit form.
 */

export interface GenerateWfcOptions extends GenerateOptions {
    /** Which biome to render the world with. Defaults to Mykonos. */
    biomeId?: string;
}

export function generateWfcWorld(
    seed: string,
    options: GenerateWfcOptions = {}
): WorldSpec {
    return generateWorld(seed, getBiome(options.biomeId), options);
}
