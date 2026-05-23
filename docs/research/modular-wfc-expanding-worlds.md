# Modular WFC for Ever-Expanding Worlds

**Status:** design proposal · 2026-05-23
**Depends on:** `libs/wfc` (`solveWfc`, `initial`), `libs/world-gen` (`generateWfcWorld`), `libs/contracts` (`WorldSpec`, `GRID_SIZE`)

**TL;DR**

- The enabling primitive already exists: `solveWfc`'s `initial(x,y)` boundary-constraint callback. Modular WFC = "solve each NxN chunk with its border constrained to match already-solved neighbors."
- Chunking is also *more reliable* than one giant solve — the source research notes ~196-cell solves "almost never fail" while multi-thousand-cell solves "fail regularly."
- Two determinism strategies: **cached outward expansion** (simple, great for "walk and it grows") and **deterministic seams** (order-independent, lets you teleport to any chunk and get a stable result).
- A low-frequency **macro biome/height map** at chunk resolution is needed so the infinite field forms archipelagos and towns rather than uniform texture.

---

## Current state

- `generateWfcWorld` solves a single fixed **14×14** grid (`GRID_SIZE`) and force-seeds the border ring to `water` via `initial`, so an island emerges from the interior.
- The schema (`libs/contracts/src/world-spec.mts`) hard-codes the 14×14 shape via `fixedGrid()` and `GRID_SIZE`. This is the main thing that must generalize.
- `solveWfc` already accepts `initial: (x,y) => readonly number[] | null` and propagates those constraints before observing — this is exactly the chunk-seam mechanism.

## Chunked WFC mechanics

A world becomes an infinite grid of **chunks**, each NxN (start with 14×14). To generate a chunk at `(cx, cy)`:

1. For each edge cell adjacent to an already-fixed neighbor edge tile `t`, set its initial domain to the tiles that may legally sit next to `t` in that direction: `{ b : allowed(t, b, dir) }`.
2. Run `solveWfc` for the chunk interior with those `initial` constraints.
3. Propagation guarantees the chunk is internally coherent *and* seamless with its neighbors.

This reuses `mykonosAllowed` and the existing engine verbatim — no algorithm changes.

## Determinism strategies

### A. Cached outward expansion (simpler)
Generate from spawn outward; cache solved chunks; constrain each new chunk's border to whatever cached neighbors exist. Pros: trivial, deterministic *given fixed exploration order*. Cons: revisiting / teleporting requires the cache (regeneration in a different order can differ).

### B. Deterministic seams (order-independent)
Generate each shared edge **first**, from its own seed: the vertical seam between `(cx,cy)` and `(cx+1,cy)` is a 1-D WFC seeded by `hash(worldSeed, cx, cy, 'V')` (and horizontal seams by `'H'`). Then each chunk solves its interior against its four already-fixed edges. Pros: chunk `(999, -40)` is reproducible without ever generating its neighbors — true infinite world, cache-optional. Cons: more moving parts (seam solver + ownership rules).

**Recommendation:** ship A first (matches "walk and it grows"), upgrade to B when arbitrary teleport/revisit is needed.

## Macro structure

Pure per-chunk WFC produces uniform texture, not geography. Add a **macro map** sampled at chunk resolution (low-frequency simplex/Perlin noise, optionally modulated by `AudioFeatures`) that labels regions:

- `open-sea` chunks → all water (or skip rendering)
- `coast` chunks → the current island recipe (water border relaxed on the land-facing edges)
- `town` chunks → higher built-tile weights

The macro label sets per-chunk weights and which edges are forced to water — the doc's "terrain base + WFC on top." This is what makes an *archipelago* you can sail/walk between rather than one endless beach.

**Macro labels are biomes.** The cleanest version of this macro layer is the **biome system** (`biomes-and-world-composition.md`): a track's selected biome shortlist is assigned to regions/chunks, each region runs WFC with its biome's catalog, and the new work is **cross-biome seams** (transition tiles so a beach district blends into a colonial-town district). "Single biome per world" is the v1; multi-biome districts are this section realized.

## Failure regime

The source research is explicit: small solves almost never fail, large single solves fail regularly. 14×14 chunks keep us safely below the failure regime *and* let `maxRestarts` stay tiny. If a seam ever over-constrains a chunk, the restart logic already handles retries; an unsatisfiable fixed seam throws (as designed) — surface that as a "regenerate seam" path.

## Schema & renderer changes

- **Schema:** introduce `ChunkSpec { cx, cy, size, tiles, heightmap, props }` (NxN, not fixed 14). Keep `WorldSpec` for bounded single worlds; a streaming world is a `Map<chunkKey, ChunkSpec>`. Generalize `fixedGrid`/`GRID_SIZE` into a size parameter.
- **Renderer:** `buildScene` currently builds one static group. For streaming, build **one group per chunk** and instantiate/dispose them by camera distance (classic chunk paging). `disposeScene` already frees geometries/materials — extend to per-chunk dispose. Share geometry/material instances across chunks to keep draw calls and memory down (instanced meshes per tile type are a strong upgrade).

## Coordinate & seeding scheme

- `chunkKey = `${cx},${cy}``
- `chunkSeed = hash(worldSeed, cx, cy)` → `createRng(chunkSeed)` for the chunk interior.
- Seam seeds (strategy B): `hash(worldSeed, cx, cy, edge)`.
- World origin (spawn) at `(0,0)`; player position → current chunk → load a ring of N chunks around it.

## What this touches in the codebase

- **`libs/wfc`:** no changes (already supports `initial`); maybe add a 1-D seam solver helper for strategy B.
- **`libs/contracts`:** `ChunkSpec` + a size-generalized grid schema.
- **`libs/world-gen`:** `generateChunk(worldSeed, cx, cy, macro)` alongside `generateWfcWorld`; a macro-map module.
- **`libs/world-core`:** per-chunk scene groups + a `ChunkStreamer` (load/unload around a focus point); instanced meshes.
- **Pairs with navigation** (see `walkable-rpg-navigation.md`): the nav grid spans loaded chunks, so walking to an edge triggers the next chunk.

## Open questions

1. Chunk size — keep 14, or go larger (e.g., 16/24) now that we're chunking?
2. Strategy A vs B for v1 (depends on whether teleport/fast-travel is a feature).
3. Does the macro map react to the song (one track = one archipelago shape), or is it world-global?
4. Memory budget: how many chunks loaded at once, and instancing strategy?

## Recommendation

Phase it: (1) generalize the grid size + `ChunkSpec`; (2) `generateChunk` with seam-constrained `initial` (strategy A, cached); (3) per-chunk renderer paging; (4) macro biome map for archipelagos; (5) upgrade to deterministic seams if fast-travel demands it.
