# PRD: Agent-Driven World Generation via a Remote MCP Server

- **Status:** Draft — exploration approved, implementation deferred
- **Date:** 2026-05-24
- **Owner:** @cbnsndwch
- **Related:** `docs/three-scene-react-migration.md`, `docs/research/biomes-and-world-composition.md`, `docs/research/driving-worlds-from-music-tracks.md`

---

## 1. Summary

Expose the `apps/three-scene` voxel scene editor's authoring primitives to AI agents
through a **headless, Node-based remote MCP server**. An MCP-capable agent (e.g. Claude
or any MCP client) takes a plain-English scene description plus a target biome and
produces a **scene document that renders identically to a human-edited scene**, because
the artifact it emits is the exact same format, over the exact same tile catalog and
`.vox` assets, that the editor itself uses.

The server is stateless infrastructure for *authoring* — it does not render pixels. The
canonical renderer remains the `three-scene` app. The server runs on **Cloudflare
Workers**, persisting scene artifacts to **R2** and metadata to **D1**.

This unlocks the headline goal: *agents that turn "a quiet fishing village on the south
shore at dusk" + a biome into a nice-looking little world that drops straight into the
same viewer humans use.*

---

## 2. Problem & motivation

Today, a scene is only authorable by a human dragging tiles in the browser editor. The
editor's logic is already cleanly split — a pure data/logic core (`TileMap` +
`PlacementSystem` + catalog) with **zero DOM/WebGL dependency**, wrapped by a rendering
shell (`SceneView`) and a chrome (`src/ui/*`). That separation means the authoring
capability humans have can be offered to an agent **without scraping the DOM or driving a
browser** — by calling the same intent primitives directly.

We want agents to generate scenes that are **indistinguishable from hand-built ones** at
render time, and to do so at scale, headlessly, with the outputs stored and retrievable.

---

## 3. Goals & non-goals

### Goals

- **G1.** A remote MCP server exposing the editor's authoring primitives as well-described
  tools (place, erase, fill, inspect, finalize) over the real tile catalog.
- **G2.** Server-side enforcement of the editor's placement rules so an agent can only
  produce **valid** scenes (in-bounds, real tile ids, legal stacking, valid rotation).
- **G3.** Output artifacts that render **identically to human-edited scenes** in
  `three-scene` — i.e. the same scene-document JSON contract, plus an optional baked
  `.vox`.
- **G4.** Deployable to **Cloudflare Workers**, persisting artifacts to **R2** and a
  metadata index to **D1**.
- **G5.** A single shared authoring core that is the one source of truth for catalog
  schema, placement rules, serialization, and `.vox` composition — consumed by *both* the
  editor and the MCP server (no forked rules).

### Non-goals (this phase)

- **N1. WebMCP / in-browser `navigator.modelContext`.** Explicitly out of scope; revisit
  later as a thin second adapter over the same core (see §11).
- **N2. Headless pixel rendering / screenshots.** The server emits scene documents, not
  images. Rendering parity is achieved by *format identity*, not by re-rendering on the
  server (see §8). A render/thumbnail worker is future work.
- **N3. Deterministic generation (WFC / biome generators).** The prior
  `libs/world-gen` + `libs/world-core` WorldSpec/biome direction was a PoC that did not
  prove fully workable and is **not** the render target. It will be revisited later as a
  source of **higher-level primitives** the agent can orchestrate (see §11), not as the
  output contract.
- **N4. Natural-language understanding inside the server.** The agent does the
  English→tool-calls translation. The server only exposes a well-described vocabulary and
  enforces validity.

---

## 4. Decisions locked in (from the 2026-05-24 exploration)

1. **WebMCP is shelved** for now; come back to it later.
2. **Headless authoring core + Node-based remote MCP server** is the committed path.
3. **Deploy to Cloudflare**, persisting outputs to **R2** and/or **D1**. Detailed
   deployment/infra plan to be produced at implementation time.
4. **Commit to the `three-scene` direction** as the renderer and the output contract. The
   old WorldSpec/WFC/biome render direction is treated as a superseded PoC.
5. **Deterministic generation is out of scope now**, to return later as orchestration
   primitives exposed *through* the MCP server.

---

## 5. Users & use cases

- **U1 — Agent author (primary).** An MCP client connects, lists the catalog and rules,
  is given a prompt + biome, places tiles to compose a scene, validates as it goes, and
  finalizes. Output: a stored scene document the human viewer can open.
- **U2 — Human reviewer.** Opens a generated scene document in `three-scene` to inspect /
  tweak / approve it. The scene loads exactly as if a human had built it.
- **U3 — Pipeline consumer.** Another service requests the baked `.vox` or scene JSON by
  id (e.g. to feed a downstream voxel pipeline or a future render worker).

---

## 6. Scope

### 6.1 Shared authoring core (new library)

Extract the framework-agnostic editing logic into a standalone package (working name
`@cbnsndwch/scene-author`) so the editor and the MCP server share one implementation:

- **Catalog** — tile definitions `{ id, name, category, stackable }` and the load/index
  helpers (`config.ts` today: `ASSET_INDEX`, `assetsForCategory`, `isStackable`,
  `setCatalog`).
- **Scene model** — the `TileMap`: a `width × height` grid of bottom→top column stacks of
  `{ id, rot }` cells, with `serialize()` / `load()` (`grid/tile-map.ts` today).
- **Placement rules** — `PlacementSystem.canPlace / place / erase` (`grid/placement-system.ts`),
  including the single stacking invariant: *a cell may start a column; stacking requires
  the supporting top cell to be `stackable`.*
- **`.vox` composition** — `composeSceneVoxels` (`core/export-vox.ts`), reusing the
  existing `encodeVox` from `@cbnsndwch/world-core`. The browser-only download wrapper
  (`downloadSceneVox`) stays in `three-scene`.

This core has **no DOM, no Three.js, no React** — it already doesn't, structurally; the
work is to physically move it behind a package boundary that `three-scene` then imports
(no behavior change to the editor).

> **Dependency to resolve:** `.vox` composition needs each tile's per-voxel data. In the
> browser this comes from `VoxelAssets` fetching `public/voxels/*.vox`. The headless server
> must load the same `.vox` files server-side (bundled with the catalog snapshot or pulled
> from R2). `@cbnsndwch/world-core` already decodes `.vox`, so this is wiring, not new
> capability.

### 6.2 Remote MCP server (new app)

A new app (working name `apps/world-mcp`) that wraps the shared core as MCP tools and runs
on Cloudflare Workers. Transport: streamable HTTP / SSE (remote MCP). Authenticated (see
§9, mirror the existing API's `x-api-key` / `ApiKeyGuard` pattern).

### 6.3 Tool surface (product-level)

Exact schemas defined at implementation time; the intended capability surface:

| Tool | Purpose |
|---|---|
| `list_catalog` | Return live tiles with `id`, `name`, `category`, `stackable`, plus any descriptive metadata the agent needs to map language → tiles. |
| `get_grid_info` | Grid dimensions and the placement rules (stacking, bounds, rotations 0–3). |
| `create_scene` | Start a scene for a `{ biome, width?, height? }`; returns a session/scene id. |
| `place_tile` | `place(id, gx, gy, rot)` — pushes onto the column stack; rejects illegal placements with a structured reason. |
| `erase_cell` | Pop the top cell of a column. |
| `fill_terrain` | Carpet all empty cells with a terrain tile (mirrors the editor's `fillTerrain`). |
| `can_place` / `get_cell` / `get_scene` | Inspection — validity probe, single column read, full serialized scene. |
| `undo` / `redo` | Optional, backed by the existing snapshot history. |
| `finalize_scene` | Validate, serialize, bake `.vox`, persist to R2/D1, return ids + keys. |

**Validation is a first-class feature:** every mutating tool returns a structured success
or a machine-readable error (`out_of_bounds`, `unknown_tile`, `not_stackable`,
`bad_rotation`) so the agent can self-correct rather than producing broken scenes.

### 6.4 Session model (open design choice — see §10)

Either (a) **server-held session state**: `create_scene` → in-memory/Durable-Object
`TileMap` per session, mutated by subsequent calls; or (b) **stateless round-trip**: each
call takes and returns the scene document. Lean toward (a) for ergonomics on Workers
(Durable Objects fit naturally), but this is to be settled at design time.

---

## 7. Artifact contracts

The **interop contract is format identity** — this is what makes generated scenes render
like human-edited ones.

- **Scene document (canonical).** Identical to what `three-scene`'s `SaveSystem` persists
  and `TileMap.load` accepts:
  ```jsonc
  {
    "width": 14,
    "height": 14,
    "terrain": [ /* width*height columns, each a bottom→top array of { "id": string, "rot": 0|1|2|3 } */ ]
  }
  ```
  Any drift between this and the editor's format breaks parity, so the schema lives in the
  shared core and both sides import it.
- **Baked `.vox` (optional).** `composeSceneVoxels` → `encodeVox`; a tight, origin-aligned
  MagicaVoxel model for external viewers / downstream pipelines.
- **Catalog snapshot + version.** The scene references tile `id`s. The catalog the scene
  was authored against must be pinned and stored alongside it, so a later render resolves
  the same tiles/assets even if the live catalog evolves.
- **Metadata record (D1).** `{ id, prompt, biome, catalogVersion, width, height,
  voxelCount, createdAt, r2SceneKey, r2VoxKey? }` — the queryable index.

---

## 8. Rendering parity (how we guarantee "looks human-edited")

We do **not** re-render on the server. Parity is guaranteed structurally:

1. The agent emits the **same scene-document format** the editor saves.
2. Over the **same tile catalog** and the **same `.vox` assets**.
3. Validated by the **same placement rules**.
4. Opened in the **same renderer** (`three-scene`).

Because the shared core (§6.1) is the single source of truth for all four, a generated
scene is byte-compatible with a hand-built one and renders identically. The only correct
way to view a generated scene is to load it in `three-scene` (or a future headed render
worker) — there is no separate "agent renderer" to diverge.

---

## 9. Deployment (Cloudflare) — to be detailed at implementation time

- **Compute:** Cloudflare Workers (remote MCP over HTTP/SSE). No GPU/WebGL needed since the
  server only authors.
- **State:** Durable Objects if we adopt server-held sessions (§6.4).
- **Artifacts:** **R2** for scene JSON, baked `.vox`, and the pinned catalog snapshot.
- **Index:** **D1** for the metadata records and lookups (by id, biome, track, date).
- **Auth:** API-key gated, mirroring the existing Musicologia API `x-api-key` pattern; the
  endpoint is public-facing.
- **Assets:** the catalog's `.vox` set must be available to the Worker (bundled snapshot or
  R2-hosted), since `.vox` baking needs per-tile voxel data.

A dedicated infra/deployment plan (Worker bindings, R2 bucket, D1 schema + migrations,
secrets, CI) will be written when implementation starts.

---

## 10. Open questions

- **OQ1. Session model** — server-held (Durable Object) vs. stateless round-trip (§6.4)?
- **OQ2. Canvas size** — the grid is a fixed 14×14 today (`CONFIG.grid`). Is that the right
  canvas for agent-authored scenes, or should dimensions be a parameter?
- **OQ3. Quality evaluation** — "looks human-edited" is subjective. Do we need a rubric, a
  human approval step (U2), or heuristics (coverage, coherence, biome-appropriate tile mix)?
- **OQ4. Catalog richness** — current catalog is small and beach/Mykonos-leaning
  (grass/sand/path/stone/water/sea_wall/boulder/fine_path). Good agent output needs a
  richer, well-described vocabulary per biome; how is that grown and described to the agent?
- **OQ5. Catalog versioning** — strategy for pinning and migrating scenes when the catalog
  changes (tiles renamed/removed/soft-deleted).
- **OQ6. Biome semantics** — with deterministic generation out of scope, what does `biome`
  *do* in this phase beyond scoping/labeling the catalog and guiding the agent?

---

## 11. Future work

- **F1. Deterministic generation as higher-level primitives.** Revisit WFC/biome
  generation as **macro-tools** the agent orchestrates — e.g. `generate_base_layout(biome,
  seed)` produces a coherent starting `TileMap` that the agent then refines tile-by-tile
  through the same primitives (taste = agent, bulk layout = solver). This layers on top of
  the core without changing the output contract.
- **F2. WebMCP in-browser adapter.** Register `navigator.modelContext` tools over the
  *same* shared core, inside the live (post-React-migration) editor, for human-in-the-loop
  authoring with real-time render. Deferred per §3 N1.
- **F3. Render/thumbnail worker.** A headed-browser or offline renderer that turns a stored
  scene document into preview images for galleries/review.
- **F4. Music-track-driven generation.** Tie scene generation to the Musicologia
  track→biome selection so a track id seeds the prompt + biome automatically.

---

## 12. References

- Editor scene model: `apps/three-scene/src/grid/tile-map.ts`
- Placement rules: `apps/three-scene/src/grid/placement-system.ts`
- Intent API (editor controller): `apps/three-scene/src/core/game.ts`
- Catalog: `apps/three-scene/src/config.ts`, `apps/three-scene/public/voxels/catalog.json`
- Persistence format: `apps/three-scene/src/storage/save-system.ts`
- `.vox` composition: `apps/three-scene/src/core/export-vox.ts` (+ `encodeVox` in
  `@cbnsndwch/world-core`)
- React migration (engine-as-singleton intent API): `docs/three-scene-react-migration.md`
- WebMCP background (deferred): <https://webmcp.link/>,
  <https://www.scalekit.com/blog/webmcp-the-missing-bridge-between-ai-agents-and-the-web>
