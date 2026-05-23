import type { Biome } from './biome.mjs';
import { cyberpunkBiome } from './biomes/cyberpunk.mjs';
import { mykonosBiome } from './biomes/mykonos.mjs';
import { cubanBeachBiome } from './biomes/cuban-beach.mjs';
import { raveFestivalBiome } from './biomes/rave-festival.mjs';
import { solarpunkBiome } from './biomes/solarpunk.mjs';
import { bollywoodGhatsBiome } from './biomes/bollywood-ghats.mjs';
import { tobaccoPlantationBiome } from './biomes/tobacco-plantation.mjs';
import { spanishColonialBiome } from './biomes/spanish-colonial.mjs';
import { jazzQuarterBiome } from './biomes/jazz-quarter.mjs';
import { nordicFjordBiome } from './biomes/nordic-fjord.mjs';
import { tokyoCityPopBiome } from './biomes/tokyo-city-pop.mjs';
import { desertOasisBiome } from './biomes/desert-oasis.mjs';
import { rioCarnivalBiome } from './biomes/rio-carnival.mjs';
import { jungleCanopyBiome } from './biomes/jungle-canopy.mjs';
import { arcticBaseBiome } from './biomes/arctic-base.mjs';
import { amazonRiverVillageBiome } from './biomes/amazon-river-village.mjs';
import { ancientAcropolisBiome } from './biomes/ancient-acropolis.mjs';
import { oceanReefBiome } from './biomes/ocean-reef.mjs';
import { westAfricanSavannaBiome } from './biomes/west-african-savanna.mjs';
import { polynesianAtollBiome } from './biomes/polynesian-atoll.mjs';

/**
 * The biome catalog. Selection (`vibe + origin → biome`) and the generators
 * resolve biomes by id through here. Register new biomes as they're authored.
 */

export const DEFAULT_BIOME_ID = 'mykonos';

const registry = new Map<string, Biome>([
    [mykonosBiome.id, mykonosBiome],
    [cyberpunkBiome.id, cyberpunkBiome],
    [cubanBeachBiome.id, cubanBeachBiome],
    [raveFestivalBiome.id, raveFestivalBiome],
    [solarpunkBiome.id, solarpunkBiome],
    [bollywoodGhatsBiome.id, bollywoodGhatsBiome],
    [tobaccoPlantationBiome.id, tobaccoPlantationBiome],
    [spanishColonialBiome.id, spanishColonialBiome],
    [jazzQuarterBiome.id, jazzQuarterBiome],
    [nordicFjordBiome.id, nordicFjordBiome],
    [tokyoCityPopBiome.id, tokyoCityPopBiome],
    [desertOasisBiome.id, desertOasisBiome],
    [rioCarnivalBiome.id, rioCarnivalBiome],
    [jungleCanopyBiome.id, jungleCanopyBiome],
    [arcticBaseBiome.id, arcticBaseBiome],
    [amazonRiverVillageBiome.id, amazonRiverVillageBiome],
    [ancientAcropolisBiome.id, ancientAcropolisBiome],
    [oceanReefBiome.id, oceanReefBiome],
    [westAfricanSavannaBiome.id, westAfricanSavannaBiome],
    [polynesianAtollBiome.id, polynesianAtollBiome]
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
