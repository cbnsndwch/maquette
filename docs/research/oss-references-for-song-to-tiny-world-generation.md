# Musicologia × Three.js: OSS References for Song-to-Tiny-World Generation

**TL;DR**

- The highest-leverage starting points are **marian42/wavefunctioncollapse** + **LingDong-/ndwfc** (deterministic WFC over a grid of hand-authored blocks), **Ammaar-Alam/minebench** + **locchung/three-js-mcp** (LLM tool-calls / JSON → Three.js scene), and **anomalyco/opentui** with its `@opentui/three` package (the *same* Three.js scene runs in browser, Tauri webview, and terminal). Fork the WFC + MCP pieces, glue them with a seeded PRNG hashed from the Spotify track ID, and you have the spine of musicologia's per-track worlds.
- For the cozy/Mykonos look, lean on **Quaternius** + **Kenney** CC0 packs (Kenney's All-in-1 bundle states it "contains more than 60.000 game assets in a single download") piped through **Coding-Kiwi/threejs-vox-loader** (PBR + emissive support, npm-installable), then style with a **Kuwahara painterly pass** (Maxime Heckel) plus a **Bayer ordered-dither** post-process (samwhitford / WoodNeck) — those four ingredients reproduce the sun-bleached, painterly look in 3D rather than via pre-rendered sprites.
- Avoid pure audio-reactive visualizers (Kaleidosync, Coala/Codrops, Tessellator) for the *generation* layer — they're great references for FFT plumbing, but you want a **persistent world per song**, which is a `(track features) → seed → deterministic-or-LLM scene spec → Three.js render` pipeline, not a per-frame reactive shader.

---

## Key Findings

1. **Two paradigms, one scene format.** Whether the world comes from WFC/noise/L-systems (deterministic) or from a Claude/GPT structured response (LLM), it can land in the same JSON scene-spec (tiles[14×14] + props + palette + camera + post-fx). Designing that intermediate spec first lets you swap paradigms behind a feature flag, which is the architecture you described wanting.
2. **OpenTUI already has a Three.js renderer.** `@opentui/three` is a WebGPU-backed Three.js renderer that draws to the terminal using 24-bit-color partial-block characters. The same Three.js scene graph can target browser (WebGL/WebGPU), Tauri (system webview), and terminal — no rewrites, just three render targets.
3. **Tauri + Three.js is a solved-but-fiddly combo.** WebGL works on all platforms; WebGL2 historically had WebView gaps (tauri-apps/tauri#2866), and asset loading needs `convertFileSrc` / the asset protocol rather than raw `fetch` (tauri-apps/tauri discussion #5045). Plan for a thin asset-URL adapter in your Three.js core.
4. **Hex/grid WFC at the scale you need is fast and runs entirely client-side.** Felix Turner's hex-map-wfc generated "about 4,100 hex cells across 19 grids, generated in ~20 seconds" using *modular* sub-grids (each grid solved independently, then stitched via border constraints). Your 14×14 = 196 cells is trivially solvable in <100 ms with `LingDong-/ndwfc` or `kchapelier/wavefunctioncollapse` — fine for on-the-fly per-track generation.
5. **The LLM angle is real but the ecosystem is tiny.** Outside of Allen AI's Holodeck (Unity, research-scale), the actually-hackable OSS in this space is single-author and small — `locchung/three-js-mcp` (22★), `Ammaar-Alam/minebench` (130★), `neuroidss/LLM_Plays_3D` (1★). All three demonstrate the structured-tool-call → Three.js mutation pattern at a scale you can fork.

---

## A) Deterministic / Procedural references

Ranked by directness for the musicologia use case.

1. **marian42/wavefunctioncollapse** — Walk through an infinite, procedurally generated 3D city built from ~100 hand-authored blocks with adjacency rules. The accompanying blog posts (`marian42.de/article/wfc/` and `…/infinite-wfc/`) are the canonical writeup of "how to do WFC on a 3D voxel grid with rotated module variants, lowest-entropy collapse, and backtracking." Unity/C# source, but the *algorithm and module-design methodology* port directly to JS. **Use for:** the design pattern of authoring ~30–60 Mykonos blocks (whitewashed wall, blue-dome chapel, stairs, plaza tile, olive tree, etc.) with edge-connector codes, then letting WFC arrange them into a 14×14 island.
2. **LingDong-/ndwfc** (MIT) — N-dimensional WFC in pure JavaScript with infinite-canvas expansion, web-worker support, and `WFCTool2D`/`WFCTool3D` helpers that already speak Three.js geometry. The most directly forkable JS WFC implementation for browser + Bun + Tauri. **Use for:** the runtime engine.
3. **kchapelier/wavefunctioncollapse** — ES6 port of mxgmn's original (`OverlappingModel` + `SimpleTiledModel`) that writes results into an `ImageData`. Useful as a fallback for the 2D overhead/biome-mask pass that feeds your 3D tile layer. (npm: `wavefunctioncollapse`.)
4. **briossant/wfc-r3f** — GPLv3 (caveat: copyleft). WFC running natively in React Three Fiber, live demo at briossant.com. **Use for:** if you adopt R3F, this shows the exact integration. Note the GPL: study only, don't vendor.
5. **felixturner/hex-map-wfc** — Production-quality hex-tile WFC at ~4,100 cells across 19 sub-grids using WebGPU + TSL, with KayKit's CC0 Medieval Hex pack + custom connectors. The article explains *modular* WFC (split the grid into 19 hexagonal sub-regions and stitch via border constraints) and why WFC fails for large-scale clustering (trees, villages) — a critical lesson if you ever want to scale past 14×14.
6. **mxgmn/WaveFunctionCollapse** — The original C# implementation by Maxim Gumin. Read for the algorithm; don't fork.
7. **marian42's high-perf solver thread** on the Three.js forum (`discourse.threejs.org/t/.../81704`) — a 2026 discussion of optimized WFC integration patterns for Three.js. Useful primary source for performance tuning.
8. **IceCreamYou/THREE.Terrain** + `repcomm/THREE.Terrain` — Procedural terrain (diamond-square, Perlin, hill, value-noise) with biome-based blended materials and `scatterMeshes` for foliage. **Use for:** the *base height/terrain* of the island (Mykonos = low rocky plateau), with WFC placing buildings on top.
9. **simondevyoutube/ProceduralTerrain_Part9** and `simondevyoutube/ThreeJS_Tutorial_BasicWorld` (MIT) — Companion repos to Simon Dev's YouTube series; clean reference for a hand-rolled noise-stack approach if you don't want to depend on THREE.Terrain.
10. **FarazzShaikh/Terrain-Builder** — GPU-accelerated Perlin terrain in Three.js. Smaller scope, easy to read.
11. **jasonsturges/three-low-poly** — A toolkit of procedurally generated low-poly geometry (trees, rocks, books, prefabs) with a "factory" API for grids and randomized layouts. **Use for:** the prop layer once WFC has chosen tile types ("this tile is a plaza → drop 2 olive trees + a bench from three-low-poly").
12. **dimartarmizi/threejs-procedural-terrain** — Vanilla JS + Vite starter for chunked procedural terrain with biome-driven surfaces; small enough to read end-to-end.
13. **luciopaiva/magicavoxel-threejs-howto** + **Coding-Kiwi/threejs-vox-loader** (`npm i threejs-vox-loader`) — Walkthrough and modern loader for `.vox` files: PBR materials, emissive voxels → real PointLights, glass/transparency, multi-object scenes. The original `THREE.VOXLoader` in three.js examples only supports VOX version 150 and ignores material data; `threejs-vox-loader` fixes both. **Use for:** asset pipeline from MagicaVoxel → Three.js, so artists can author Mykonos blocks in MagicaVoxel and you load them at runtime.
14. **davidbau/seedrandom** — The classic seeded PRNG library (`new Math.seedrandom('hello.')` always returns `0.9282578795792454` on first call). Pair with a string-to-seed hash (Mulberry32 + MurmurHash3 — see `tempercode.dev/snippets/seeded-random-javascript` and `delftstack.com/howto/javascript/javascript-random-seed`) to deterministically convert `track.id` (or `artist + title`) into a stable seed for WFC. This is the glue that makes "the same song always generates the same world."
15. **Anthelmed/threejs-experiment-audio** — Tiny Three.js + Spotify audio-analysis-API experiment. Closest existing repo to "Spotify features → Three.js," but reactive rather than generative — useful to see the auth/API plumbing only.

**Avoid (per your brief, but worth naming explicitly):** `zachwinter/kaleidosync`, `amertx/spotify-visualizer`, Coala/Codrops tutorial, Tessellator, Groovescape. All are real-time FFT visualizers, not world generators.

---

## B) LLM-driven scene composition references

The OSS here is sparser and smaller. Verified May 23, 2026.

1. **Ammaar-Alam/minebench** — 130★, Next.js + Three.js. The closest match to your use case: a user prompt is sent to one of many LLM providers (the README lists **OpenAI, Anthropic, Google, Moonshot, DeepSeek, MiniMax, xAI, Z.AI, Qwen, Meta, and any model available through OpenRouter** — 10+ named providers), and the LLM either (a) emits a JSON array of `{x,y,z,block}` voxel coordinates, or (b) calls a tiny `voxel.exec` DSL with three primitives — `block`, `box`, `line` — to scale to thousands of blocks. Output renders in a Three.js viewer and exports to GLB/STL/.schem. The `lib/ai/prompts.ts` file is a ready-made template for structured-output prompting. **Highest LLM-pipeline fit.** (Verify the LICENSE file before vendoring — license badge wasn't surfaced.)
2. **locchung/three-js-mcp** — 22★, MIT, TypeScript. An MCP server exposing `add_object`, `move_object`, `rotate_object`, `get_scene_state` over WebSocket. Claude (or any MCP-aware client) issues JSON tool calls; the WS server forwards them to a connected Three.js page which mutates the scene graph live. Single-commit "basic function" scaffold — exactly the size you want to fork. **Use for:** the MCP/tool-call → Three.js bridge. Replace its primitives with `spawn_house(palette, size)`, `place_olive_tree(x,y)`, etc.
3. **neuroidss/LLM_Plays_3D** — 1★, AGPL-3.0 (caveat: copyleft). Runs Qwen2.5-Coder via **WebLLM in the browser** (no server), defines a custom-tools protocol where the LLM emits ` ```json ` blocks, JS parses and dispatches. Includes a meta-tool `tool_creation_tool` that lets the LLM define and `eval()` new JS tools at runtime. **Use for:** a fully client-side reference (works inside Tauri without an LLM server).
4. **allenai/Holodeck** — 538★, Apache-2.0, Python/Unity. GPT-4o is prompted in multiple rounds: floor plan → walls → object list with spatial-constraint relations → DFS/MILP solver places Objaverse assets → AI2-THOR Unity render. Too large to fork, but the **prompt-engineering pattern (decompose into rounds, emit relational constraints, solve)** transfers directly: think "verses → rooms," "instruments → object categories," "key → palette."
5. **Sanjays2402/ai-particle-simulator** — 1★, MIT, React + Vite + R3F + drei + postprocessing + Zustand. An OpenAI-compatible call asks the LLM to emit a JS particle-simulation snippet + a dynamic sliders schema; the client loads it into a `<Canvas>` running 20K GPU particles. Closest to a "live-editable LLM scene parameters" loop in pure browser/R3F.
6. **mac999/blender-llm-addin** — 21★, MIT, Python. LLM (OpenAI or local Ollama: Gemma/Phi/CodeLlama/Qwen2.5) emits Blender `bpy` Python, addon `exec()`s it with auto-retry on syntax errors. *Targets Blender, not Three.js* — but the "LLM emits code → renderer execs → retry on parse failure" pattern is reusable.
7. **baryhuang/mcp-threejs** — MCP server that searches Sketchfab for downloadable GLB/GLTF models the LLM can drop into a Three.js scene. Useful if you want LLM-driven *asset selection* (genre → "look up cozy Mediterranean models on Sketchfab") rather than primitive-geometry composition.
8. **JSON Object Scene format 4** (`mrdoob/three.js wiki`) — Not a repo, but the format spec for Three.js's own scene serialization. Your LLM-emitted JSON can target *this exact schema* and load via `THREE.ObjectLoader` without writing a custom parser.

**Structured-output mechanics (not repos, but key engineering references):**

- Anthropic's tool-use / Claude function-calling API; OpenAI Structured Outputs (strict JSON Schema mode); Outlines / Microsoft Guidance / XGrammar for self-hosted constrained decoding (Emre Karatas's Medium primer and BentoML's LLM Inference Handbook are good explainers; Fireworks's "Why do all LLMs need structured output modes?" covers grammar mode for arbitrary CFGs). Use Pydantic on the server (or Zod on the Node/Bun side) to define the `WorldSpec` schema and have Claude's Messages API enforce it.

**What I could not find OSS for:** a Lucas Bassetti "generative city from text" repo (does not exist — likely misremembered; his actual GitHub repos are chatbot UIs and CSS loaders); an unofficial JS/Three.js port of Holodeck; a dedicated Anthropic cookbook example specifically for placing 3D objects on a grid.

---

## C) Mykonos-style aesthetic & technique references in 3D

1. **Quaternius** (`quaternius.com`, itch.io) — All assets **CC0**, FBX/OBJ/Blend formats. Specifically relevant packs: Ultimate Nature (150+ models), Lowpoly Farm Buildings, LowPoly Animated Monsters, Cars. The "Mykonos kit" you'd assemble in Blender or MagicaVoxel for your 14×14 tile set.
2. **Kenney.nl** — Per the Kenney All-in-1 bundle page on itch.io: "Kenney Game Assets All-in-1 is a collection of all our freely available content and contains more than 60.000 game assets in a single download." All CC0. Pair with Quaternius for breadth.
3. **madjin/awesome-cc0** — Curated list pointing to Polygonal Mind, itch.io CC0, ambientcg, Texture Ninja, etc. Use as a discovery hub.
4. **Coding-Kiwi/threejs-vox-loader** (already in §A) — best path from MagicaVoxel → Three.js with PBR + emissive.
5. **manbust/three-js-toon-shader** — Production-grade Toon Shader for Three.js: gradient-map cel shading + depth/normal-buffer edge detection (not the cheap inverted-hull trick). Live demo at `manbust.github.io/three-js-toon-shader/`. Good base for a stylized, painterly Mediterranean look.
6. **mayacoda/toon-shader** — Smaller, hackable toon shader; pairs with Maya Nedeljkovich's blog tutorial. Read this first if learning, fork manbust's if shipping.
7. **hujiulong/toon-shading** — Another minimal Three.js toon-shading reference.
8. **Maxime Heckel — "On Crafting Painterly Shaders"** (`blog.maximeheckel.com/posts/on-crafting-painterly-shaders/`) — Implementation of the **Kuwahara filter** as a post-processing pass in R3F, with quantization for reduced palette and "Anisotropic Kuwahara" (Giuseppe Papari's edge-and-corner-enhancing variant) for natural brush strokes. **This is the single most useful technique for the sun-bleached, painterly Mykonos look** — sandy whites, soft cyans, brush-stroke edges.
9. **Maxime Heckel — "The Art of Dithering and Retro Shading"** + **samwhitford/threejs-ordered-dithering-effect** (MIT) + **WoodNeck/three-pixelate-showcase** + **homeisfar/threejs-dithershader** — Bayer-matrix ordered dithering as a post-processing effect, with palette quantization (CGA Mode 4 / Apple II / MSX / Commodore VIC-20 / C64 / Gameboy palettes are all demonstrated in "The Dither Room" forum post). Combine with a Mykonos-specific 8-color palette (whitewash, ultramarine, terracotta, olive, dust, sand, sea, sky) for a gorgeous low-fi look.
10. **chadhillary.com — 1-Bit Post-Processing Shader in Three.js** — "Return of the Obra Dinn"–style 1-bit + 8×8 Bayer matrix + custom MeshLambertMaterial edge shader. Reference if you want an even more graphic, less painterly variant per genre.
11. **tympanus.net/codrops — "Building a Real-Time Dithering Shader"** — TypeScript/`postprocessing` integration of an ordered-dither + pixelation `Effect` class; drop-in for R3F/Three.js.
12. **1391819/interactive-low-poly-environment** — A complete Three.js interactive low-poly environment with procedurally generated stones/foliage, lamp posts, day/night cycle, displacement-mapped water. Closest existing "cozy 3D island" repo aesthetically.
13. **nextgtrgod/threejs-floating-island** (`threejs-lowpoly-world`) — A small, charming low-poly floating island demo. Tiny, hackable, perfect aesthetic reference.
14. **theimpossibleastronaut/diorama** — A simple Three.js diorama-style scaffold. Useful as the outermost wrapper (small world floating on a platform).
15. **lospec.com palettes** (not a repo, but) — Use Lospec to design the per-genre 8-color palette your LLM/WFC pipeline assigns from `track.audio_features.valence × energy`.

---

## D) OpenTUI / terminal rendering

1. **anomalyco/opentui** — 11,255★ (per the GitHub org page, last updated May 20, 2026), MIT, native Zig core + TS bindings. Crucially ships `@opentui/three`, a **Three.js WebGPU renderer for the terminal** — same Three.js scene graph, rendered via 24-bit color + Unicode partial-block characters, no special terminal features needed beyond 24bit color. Also provides `@opentui/react` and `@opentui/solid` reconcilers. Powers OpenCode in production. **This is the third render target in your stack and the technical pivot point that makes the "one Three.js core across browser, Tauri, terminal" plan feasible.**
2. **@opentui/examples** — Run via `curl -fsSL https://raw.githubusercontent.com/anomalyco/opentui/main/packages/examples/install.sh | sh`. Includes Three.js examples; start here.
3. **remorses/ghostty-opentui** — Renders ANSI/PTY output inside OpenTUI via a Zig parser; tangential to your use case but interesting if you ever want to embed terminal output into the world (e.g., a tiny "now playing" terminal in the scene).
4. **starlog.is article on OpenTUI** — Plain-English overview of the architecture, dirty-region tracking, the experimental status of the WebGPU-to-terminal rasterizer. **Caveat to flag in your design doc:** the article explicitly notes "The WebGPU renderer, while innovative, is experimental. It works, but documentation is thin and performance characteristics aren't well-documented. Rendering complex 3D scenes to ASCII creates CPU pressure from the rasterization step."

---

## E) Tauri-specific 3D references

1. **tauri-apps/tauri#2866** — Known WebGL2 unavailability in older WebView versions on macOS; mostly resolved on modern WebView2/WebKit, but pin your Tauri version and CI-test all three OSes.
2. **tauri-apps/tauri#5045** + **erikpa1/tauri_threejs** — The canonical small reference repo showing how to load `.glb` (or any binary asset) in a Tauri-shipped Three.js app. Key takeaway: don't `fetch("/assets/x.glb")` — use `convertFileSrc(path)` and the asset protocol. Build a thin `assetUrl(name)` helper in your Three.js core and back it with `convertFileSrc` in Tauri, the public URL in browser, and a local `file://` in OpenTUI.
3. **yangbo/hello-tauri** — Tauri + Vue + WebGL learn-by-example.
4. **yandeu/tauri-webxr-test** — Tauri + WebXR + Three.js (forum thread on discourse.threejs.org). Out of scope for musicologia, but a proof point that WebXR rides through Tauri.
5. **CosmoRisk** (listed under GitHub Topics → tauri) — Tauri + Three.js NASA-data NEO-defender simulator. Larger production reference for "real Three.js app shipped as Tauri."

---

## Synthesis: 5 repos to study/fork first

If I were starting musicologia's per-track 3D world today, I'd clone these in this order:

1. **LingDong-/ndwfc** — drop in as the WFC engine; tune to 14×14 with 2D first (tile types only), upgrade to 3D once the tile catalog is stable.
2. **anomalyco/opentui** (+ `@opentui/three`) — set up the three-target build (browser/Tauri/TUI) **before** writing any scene code, so your Three.js core stays renderer-agnostic from day one.
3. **Coding-Kiwi/threejs-vox-loader** — your asset pipeline. Author Mykonos blocks in MagicaVoxel; load them with PBR + emissive support. Combine with **Quaternius** + **Kenney** CC0 packs as filler.
4. **locchung/three-js-mcp** (or **Ammaar-Alam/minebench** if you want a richer reference) — your LLM track. Wrap Anthropic's Messages API + tool use with a strict JSON-schema `WorldSpec` (palette, biome, tile-grid hints, props), and have Claude either emit the spec directly or call `place_tile(x,y,type)` tools.
5. **Maxime Heckel's painterly + dithering posts** (Kuwahara pass + Bayer ordered dither + palette quantization) — your aesthetic layer. This is what separates "another voxel demo" from a sun-bleached, cozy, branded musicologia look.

**The integration sketch:**

```
spotify_track
  → hash(track.id) → seed
  → if user prefers DETERMINISTIC:
       WorldSpec = wfc(seed, tile_catalog, constraints_from(audio_features))
     else (LLM):
       WorldSpec = claude.messages.create({
         response_format: WorldSpecSchema,
         input: { track_metadata, palette_hint, allowed_tiles }
       })
  → render(WorldSpec) → three.Scene
  → target ∈ { WebGLRenderer (browser), WebGLRenderer (Tauri WebView), opentui/three (terminal) }
  → post-processing: Kuwahara → palette-quantize → Bayer dither → toon outline
```

The `WorldSpec` JSON sitting between input and renderer is the single most important design decision — it's what lets users toggle "deterministic vs LLM," what lets you cache worlds per `track.id`, and what lets you serialize a world to share/replay.

---

## Recommendations

**Stage 0 — design (1 day):** Write the `WorldSpec` TypeScript/Zod schema. Fields: `seed`, `paradigm` (`"wfc" | "llm"`), `palette: string[8]`, `terrain: { heightmap: number[14][14] }`, `tiles: { type: TileId, rotation: 0|90|180|270 }[14][14]`, `props: { type: PropId, x, y, scale, rotation }[]`, `weather`, `time_of_day`, `post_fx`. This is your contract.

**Stage 1 — render target (2–3 days):** Get a hello-world Three.js scene rendering identically in browser, Tauri (via `tauri-apps/create-tauri-app` + `convertFileSrc` for assets), and OpenTUI (`@opentui/three`). Don't move on until all three render the same `WorldSpec`.

**Stage 2 — deterministic path (1 week):** Author 20–40 MagicaVoxel "Mykonos kit" blocks (CC0 or your own), load with `threejs-vox-loader`, define WFC adjacency rules, wire `LingDong-/ndwfc` to emit a `WorldSpec` from `(seed, audio_features)`. Seed = `mulberry32(murmur3(track.id))`.

**Stage 3 — LLM path (1 week):** Fork `locchung/three-js-mcp`'s WS bridge or use Anthropic Messages API directly with `WorldSpecSchema` as `response_format`. Map `genre → palette family`, `valence × energy → time-of-day & weather`, `tempo → density of props`, `lyrics keywords → asset-selection hints`. Cache by `track.id`.

**Stage 4 — aesthetic pass (3–5 days):** Add the Kuwahara painterly pass, Bayer ordered dither, and palette quantization (16 colors). Tune one palette per major genre as your "default" library.

**Stage 5 — polish:** Toon outlines (manbust/three-js-toon-shader), day/night cycle (from 1391819/interactive-low-poly-environment), gentle camera orbit, ambient soundbed gated by `audio_features.acousticness`.

**Benchmarks that would change these recommendations:**

- If 14×14 WFC ever takes >200 ms in the browser → switch to chunked / modular WFC (Felix Turner's 19-grid approach) or precompute on the server.
- If your LLM provider charges per token and you're calling per-track → cache `WorldSpec` by `track.id` in IndexedDB / SQLite (Tauri); regenerate only on user request.
- If OpenTUI's `@opentui/three` performance is too poor for your scenes (the experimental rasterizer can be CPU-heavy) → fall back to a simplified ASCII view derived from the `WorldSpec` directly (skip Three.js in the terminal target, render tiles as colored chars).
- If the AGPL on `neuroidss/LLM_Plays_3D` matters → don't vendor it; treat it as a read-only reference.

---

## Caveats

- **OpenTUI's `@opentui/three` is experimental** by reviewers' own description (Starlog: "The WebGPU renderer, while innovative, is experimental. It works, but documentation is thin and performance characteristics aren't well-documented") — plan to upstream fixes.
- **`locchung/three-js-mcp` has a single commit** and is labelled "basic function" in its own docs and on PulseMCP. Treat as a starter, not a library.
- **License caveats:** `briossant/wfc-r3f` is GPLv3, `neuroidss/LLM_Plays_3D` is AGPL-3.0 — both copyleft. Verify `Ammaar-Alam/minebench`'s LICENSE file before vendoring (license badge not surfaced in the search). Everything else cited here that's relevant to forking is MIT/Apache/CC0.
- **WFC fails at large scales** — Felix Turner's writeup is explicit that a 217-cell hex grid "almost never fails" while a 4,123-cell grid "fails regularly," which is exactly why he split his map into 19 sub-grids. At 196 cells (14×14) you're safely below the failure regime, but if you ever grow the grid, use modular sub-grid WFC, not naive single-solve.
- **Star counts** are point-in-time (May 23, 2026); active repos may have changed. Treat them as rough size signals only.
- **No OSS exists** for the very specific niche of "Spotify audio features → procedurally generated persistent 3D world." `Anthelmed/threejs-experiment-audio` is the closest existing thing and it's a tiny audio-reactive experiment, not a generator. You will be one of the first to ship this — which is also why it's a good project.
- **The original `THREE.VOXLoader`** in the three.js examples folder only supports VOX file version 150 ("THREE.VOXLoader: Invalid VOX file. Unsupported version: 200") and ignores PBR material data (per CodingKiwi's writeup). Use `Coding-Kiwi/threejs-vox-loader` instead; the three.js built-in is essentially unmaintained for modern MagicaVoxel files.
