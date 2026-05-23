# @cbnsndwch/contracts

Shared contracts for Musicologia: the `WorldSpec` schema, the seed PRNG, and a
few small shared types/utilities.

This package is intentionally renderer-agnostic and dependency-light (only
[Zod](https://zod.dev/)). It defines the data that flows between the generation
layer (WFC / LLM) and the rendering layer.

## Exports

### `WorldSpec`

The central contract — a serializable description of a generated world: `seed`,
`paradigm` (`"wfc" | "llm"`), an 8-color `palette`, a `GRID_SIZE`×`GRID_SIZE`
`terrain.heightmap`, a matching grid of `tiles`, scattered `props`, plus
`weather`, `timeOfDay`, and `postFx` toggles.

```ts
import { worldSpecSchema, validateWorldSpec, type WorldSpec } from '@cbnsndwch/contracts';

const spec: WorldSpec = validateWorldSpec(json); // throws on invalid input
```

### Seed PRNG

Deterministic seeding so a given track always produces the same world.

```ts
import { createRng, seedFromString } from '@cbnsndwch/contracts';

const rng = createRng('spotify:track:abc'); // () => number in [0, 1)
```

### `createSampleWorldSpec(seed)`

A placeholder, fully-deterministic generator (radial island + seeded noise). It
stands in for the real WFC generator so the renderer has valid input today.

### Misc

- `Dict<T>` — generic string-keyed dictionary type.
- `invariant(condition, message, ErrorClass?, logger?)` — assertion helper.

## License

MIT © [cbnsndwch LLC](https://github.com/cbnsndwch)
