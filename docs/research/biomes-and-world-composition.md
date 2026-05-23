# Biomes & World Composition

**Status:** design proposal · 2026-05-23
**Depends on:** `libs/world-gen` (`mykonos.mts`, generators), `libs/wfc`, `libs/contracts` (`WorldSpec`), `libs/world-core` (`build-scene`)
**Supersedes:** the "consume the descriptor's palette/motion/sceneGrammar" approach in `driving-worlds-from-music-tracks.md` — those fields were an experiment in the 2D app and underwhelmed in practice.

**TL;DR**

- Replace "honor the song's palette/motion" with a **biome system**: named, parameterized world recipes. The current Mykonos voxel world becomes **biome #1**.
- A track's **vibe + origin** (genre/tags + artist country) selects a **shortlist of biomes**, and the world is composed from them — one biome, or several as districts via modular WFC.
- Examples: Cuban → *beach + tobacco-plantation + Spanish-colonial-town*; EDM → *rave-club / festival*; punk → *cyberpunk*; pop → *solarpunk*.
- This generalizes today's Mykonos-specific catalog (`mykonos.mts`) into a `Biome` interface, makes the `WorldSpec` biome-aware, makes the renderer dispatch per biome, and is the concrete realization of modular WFC's "macro map" (`modular-wfc-expanding-worlds.md`).

---

## What a biome is

A biome bundles everything currently hard-coded for Mykonos across `libs/world-gen/src/mykonos.mts` and `libs/world-core/src/build-scene.mts`:

- a **tile vocabulary** + adjacency rules/classes + feature-modulated weights (today: `TILE_CLASS`, `mykonosAllowed`, `BASE_WEIGHTS`)
- **terrain character** (today: `TILE_HEIGHT`)
- a **palette** (the biome's color identity)
- a **prop set** + placement rules
- **appearance**: tile/prop → mesh (today: procedural boxes/meshes; later: per-biome voxel assets)
- **affinities**: how `AudioFeatures` modulate density / weather / time within the biome

```ts
interface Biome {
    id: BiomeId;                       // 'mykonos' | 'beach' | 'cyberpunk' | 'solarpunk' | ...
    tiles: TileDef[];                  // biome-local tile vocabulary
    allowed(a, b, dir): boolean;       // WFC adjacency
    weights(features): number[];       // feature-modulated tile weights
    heightOf(tileId): number;
    palette: string[];                 // biome identity colors
    props: PropPlacementRules;
    build(tileId, ctx): THREE.Object3D; // renderer hook (or a registry entry)
}
```

**Mykonos is the first implementation** — largely a refactor of today's code behind this interface. New biomes are new modules implementing the same shape.

## Contract change: a biome-aware WorldSpec

Today `TileType`/`PropType` are a fixed, Mykonos-flavored enum and the grid carries one palette. For biomes with different vocabularies (a `rave-club` has dance floors and trusses, not domes and olive trees), two options:

- **(A) one shared mega-enum** of every biome's tiles — simple, but couples biomes and bloats the enum.
- **(B) biome-scoped tile ids + a `biome` field per region** — tiles are ids local to their biome; each region (or the whole world, in v1) carries a `biome` id; the renderer dispatches to that biome's builder. Scales to arbitrary biomes. **Recommended.**

So a `WorldSpec` (or each region/chunk within it) gains a `biome` dimension, and its `tiles` are interpreted in that biome's vocabulary.

## Selection: track → biome shortlist

**Inputs**
- **vibe / genre** — from MusicBrainz tags (the descriptor already sources features from `musicbrainz-tags`), genre metadata, `energy`/`valence`, and optionally the `story` text.
- **origin** — artist country/area (from MusicBrainz artist data; **not** in the current descriptor — needs a lookup).

**Mechanism options**
- **rule table** (genre/tag → biome set): deterministic, fully controllable.
- **LLM-assisted** (a strong fit for the existing LLM path): "given vibe X and origin Y, pick 2–4 biomes from this catalog, with weights." The biome catalog is small and enumerable, so this is reliable structured output.
- **hybrid**: rules first, LLM to fill gaps or override.

**Output:** an ordered, weighted shortlist, e.g. `[{ beach: 0.4 }, { tobacco: 0.3 }, { colonialTown: 0.3 }]`.

## Composition: one world, several biomes

- **v1 — single biome per world.** Pick the top biome; generate exactly as today (the Mykonos pipeline). Proves the `Biome` abstraction with minimal new surface.
- **multi-biome — districts via modular WFC** (see `modular-wfc-expanding-worlds.md`). The biome shortlist *is* the macro map: assign biomes to regions/chunks weighted by the shortlist, and run WFC per region with that biome's catalog. The new problem is **cross-biome seams** — define transition rules/tiles (beach↔town, plantation↔town) so districts blend instead of hard-cutting. The WFC engine already supports this via the `initial` boundary constraint.

## Rendering

`build-scene.mts` hardcodes Mykonos boxes + procedural props. Per biome the appearance differs, so introduce a **biome renderer registry**: `biome.build(tileId, ctx) → Object3D`. Mykonos keeps today's procedural look; new biomes add their own and can load per-biome voxel assets (threejs-vox-loader, per the OSS survey). The `assetUrl` adapter already in `world-core` resolves those across browser/Tauri/terminal.

## What this touches

- **`libs/world-gen`:** refactor `mykonos.mts` → `biomes/mykonos.mts` implementing `Biome`; a biome registry; `selectBiomes(track)`.
- **`libs/contracts`:** biome-aware `WorldSpec` (biome id per region; biome-scoped tile ids).
- **`libs/world-core`:** biome-dispatch renderer.
- **`libs/wfc`:** unchanged — multi-biome uses the existing engine per region + seam constraints via `initial`.
- Ties together doc 1 (selection inputs) and doc 2 (composition).

## Open questions

1. **Granularity for v1:** single-biome world first, or go straight to multi-biome districts?
2. **Tile vocabulary:** shared mega-enum (A) vs biome-scoped + dispatch (B)?
3. **Selection:** rule table, LLM-assisted, or hybrid?
4. **Origin:** add an artist-country lookup (MusicBrainz area) now, or start with genre/vibe only?
5. **First biomes:** which 1–2 to author to validate the abstraction (Mykonos exists; `beach` is adjacent; pick one contrasting — `solarpunk`/`rave`)?

## Recommendation

Generalize Mykonos into a `Biome` interface (single-biome worlds first), add one contrasting biome to validate it, drive selection from genre/tags with an LLM-assisted weighted shortlist, then layer multi-biome districts via modular WFC with transition seams. Keep the raw `AudioFeatures` (energy/valence/tempo) for *in-biome* density/time/weather; drop reliance on the descriptor's `palette`/`motionProfile`/`sceneGrammar`.
