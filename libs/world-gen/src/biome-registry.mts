import type { Biome } from './biome.mjs';
import { cyberpunkBiome } from './biomes/cyberpunk.mjs';
import { mykonosBiome } from './biomes/mykonos.mjs';

/**
 * The biome catalog. Selection (`vibe + origin → biome`) and the generators
 * resolve biomes by id through here. Register new biomes as they're authored.
 */

export const DEFAULT_BIOME_ID = 'mykonos';

const registry = new Map<string, Biome>([
    [mykonosBiome.id, mykonosBiome],
    [cyberpunkBiome.id, cyberpunkBiome]
]);

export function registerBiome(biome: Biome): void {
    registry.set(biome.id, biome);
}

/** Look up a biome by id, falling back to the default if unknown. */
export function getBiome(id: string = DEFAULT_BIOME_ID): Biome {
    return registry.get(id) ?? mykonosBiome;
}

export function hasBiome(id: string): boolean {
    return registry.has(id);
}

export function listBiomes(): string[] {
    return [...registry.keys()];
}
