# @cbnsndwch/world-gen

Musicologia's world generators. Each takes a track seed (and optional
{@link AudioFeatures}) and produces a validated `WorldSpec` — the contract the
renderers consume.

## WFC path (research Stage 2)

`generateWfcWorld(seed, options?)` runs [`@cbnsndwch/wfc`](../wfc) over the
**Mykonos tile catalog** to lay out a coherent island: the sea rings the border,
beaches separate sea from land, and whitewashed buildings rise on the interior —
all from a gradient adjacency rule, no explicit radial shaping. Terrain heights,
props, palette, weather, and time of day follow. Same input ⇒ same world.

```ts
import { generateWfcWorld } from '@cbnsndwch/world-gen';

const spec = generateWfcWorld('spotify:track:abc', {
    features: { energy: 0.9, valence: 0.8, danceability: 0.7, tempo: 128 }
});
```

Audio features steer the look: `energy` lifts the built town, `acousticness`
lifts nature, `danceability` widens plazas, `valence × energy` picks the time of
day, and `tempo` sets prop density. Omitted features are filled deterministically
from the seed, so `generateWfcWorld(seed)` alone still varies per track.

## LLM path (research Stage 3)

`generateLlmWorld(seed, options?)` asks a model for a compact, schema-constrained
**WorldBrief** (palette, mood, weather, density, post-fx) and expands it into a
full `WorldSpec` through the same WFC layout engine — the model supplies taste,
the solver guarantees a coherent island. The result is tagged `paradigm: 'llm'`.

```ts
import {
    generateLlmWorld,
    createAnthropicLlmClient
} from '@cbnsndwch/world-gen';

// Offline by default: a deterministic fake client, no API key needed.
const offline = await generateLlmWorld('spotify:track:abc');

// Live: install `@anthropic-ai/sdk`, set ANTHROPIC_API_KEY + ANTHROPIC_MODEL.
const live = await generateLlmWorld('spotify:track:abc', {
    client: createAnthropicLlmClient()
});
```

The client is just `{ complete(prompt): Promise<string> }`, so any provider works.
If the model is unreachable or returns unparseable output, the call falls back to
the pure WFC path (tagged `'wfc'`) so a world is always produced.

## Exports

- `generateWfcWorld(seed, options?)` — the deterministic generator.
- `generateLlmWorld(seed, options?)` / `generateLlmWorldDetailed(...)` — the LLM path.
- `FakeLlmClient`, `createAnthropicLlmClient(...)`, `LlmClient` — model clients.
- `buildLlmPrompt`, `parseWorldBrief`, `worldBriefSchema` — prompt + brief contract.
- `deriveKnobs(features)` / `featuresFromSeed(seed)` — feature → generation knobs.
- `mykonosAllowed`, `TILE_CLASS`, `BASE_WEIGHTS`, `TILE_HEIGHT`, `PALETTES` — the
  tile catalog, reusable for tuning or alternative generators.

## License

MIT © [cbnsndwch LLC](https://github.com/cbnsndwch)
