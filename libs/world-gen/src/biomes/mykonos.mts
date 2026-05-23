import {
    GRID_SIZE,
    TILE_TYPES,
    pick,
    type AudioFeatures,
    type Prop,
    type PropType,
    type Rng
} from '@cbnsndwch/contracts';

import {
    gradientAdjacency,
    type Biome,
    type BiomeKnobs,
    type BiomeTile
} from '../biome.mjs';
import { deriveKnobs } from '../derive.mjs';
import { TILE_CLASS, TILE_HEIGHT, type MykonosTile } from '../mykonos.mjs';

/**
 * The Mykonos biome — sun-bleached Cycladic island (biome #1). Composes the
 * Mykonos tile catalog (`mykonos.mts`) and feature mapping (`derive.mts`) behind
 * the generic {@link Biome} interface.
 */

/** Props that suit each kind of buildable ground. */
const PROPS_BY_TILE: Partial<Record<MykonosTile, readonly PropType[]>> = {
    grass: ['olive-tree', 'cypress', 'pot', 'olive-tree'],
    plaza: ['bench', 'lamp', 'well', 'pot'],
    path: ['lamp', 'bench']
};

function touches(
    tiles: string[][],
    x: number,
    y: number,
    type: string
): boolean {
    const deltas = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
    ] as const;
    for (const [dx, dy] of deltas) {
        if (tiles[y + dy]?.[x + dx] === type) {
            return true;
        }
    }
    return false;
}

function placeProps(tiles: string[][], propDensity: number, rng: Rng): Prop[] {
    const props: Prop[] = [];

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const type = tiles[y]![x]! as MykonosTile;
            const choices = PROPS_BY_TILE[type];
            if (choices && rng() < propDensity) {
                props.push({
                    type: pick(rng, choices),
                    x,
                    y,
                    scale: Number((0.8 + rng() * 0.6).toFixed(3)),
                    rotation: Math.floor(rng() * 360)
                });
            }

            // A rare windmill crowns the high built tiles.
            if (type === 'wall' && rng() < 0.05) {
                props.push({
                    type: 'windmill',
                    x,
                    y,
                    scale: Number((1.1 + rng() * 0.4).toFixed(3)),
                    rotation: Math.floor(rng() * 360)
                });
            }

            // A boat bobs on water that touches the beach.
            if (
                type === 'water' &&
                rng() < 0.03 &&
                touches(tiles, x, y, 'sand')
            ) {
                props.push({
                    type: 'boat',
                    x,
                    y,
                    scale: Number((0.7 + rng() * 0.3).toFixed(3)),
                    rotation: Math.floor(rng() * 360)
                });
            }
        }
    }

    return props;
}

export const mykonosBiome: Biome = {
    id: 'mykonos',
    tiles: TILE_TYPES.map(
        (id): BiomeTile => ({
            id,
            cls: TILE_CLASS[id],
            height: TILE_HEIGHT[id]
        })
    ),
    borderTileId: 'water',
    allowed: gradientAdjacency(1),
    resolveKnobs(features: AudioFeatures): BiomeKnobs {
        return deriveKnobs(features);
    },
    placeProps
};
