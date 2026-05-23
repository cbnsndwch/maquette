# Musicologia

Turn a song into a tiny, persistent 3D world.

Musicologia maps a track (its id + audio features) to a deterministic seed, then
generates a `WorldSpec` — a serializable description of a small island world —
which is rendered with Three.js. The same `WorldSpec` can target multiple
renderers (browser today; Tauri and a terminal target later), and can be produced
either deterministically (Wave Function Collapse over a tile catalog) or by an LLM.

See [`research/`](./research) for the reference survey that motivates the
architecture.

## The pipeline

```
spotify_track
  → hash(track.id) → seed
  → paradigm = "wfc" | "llm"
       wfc:  WorldSpec = generate(seed, tileCatalog, constraintsFrom(audioFeatures))
       llm:  WorldSpec = claude.messages(..., schema = WorldSpec)
  → buildScene(WorldSpec) → THREE.Scene
  → render to target ∈ { browser, tauri, terminal }
```

The `WorldSpec` JSON sitting between input and renderer is the central contract:
it lets us toggle deterministic vs LLM generation, cache worlds per track, and
serialize a world to share or replay.

## Structure

```
├── apps/
│   └── web/            # Vite + Three.js browser render target
├── libs/
│   ├── contracts/      # @cbnsndwch/contracts — WorldSpec Zod schema, seed PRNG, shared types
│   └── world-core/     # @cbnsndwch/world-core — renderer-agnostic WorldSpec → THREE.Scene builder
├── tools/
│   ├── tsconfig/       # @cbnsndwch/tsconfig — shared TypeScript configs
│   └── dep-version-map/
└── research/           # OSS reference survey
```

## Getting started

```bash
pnpm install

# Build the libraries (contracts, world-core)
pnpm build

# Start the web app — builds the libs first, then runs the Vite dev server.
# (web is the only package with a dev task, so this starts it.)
pnpm dev

# ...or target it explicitly with Turbo:
pnpm exec turbo run dev --filter=web
```

Then open the printed local URL — you should see a sample island rendered from a
hard-coded `WorldSpec`.

## Scripts

- `pnpm build` — build all packages (Turbo)
- `pnpm dev` — run dev tasks (Vite for the web app)
- `pnpm typecheck` — type-check all packages
- `pnpm test` — run all tests (Vitest)
- `pnpm lint` / `pnpm lint:fix` — lint with Oxlint
- `pnpm format` — format with Oxfmt
- `pnpm changeset` — create a changeset for versioning

## Tooling

- [Turborepo](https://turbo.build/) — task runner / build orchestration
- [pnpm](https://pnpm.io/) workspaces
- [TypeScript](https://www.typescriptlang.org/)
- [Three.js](https://threejs.org/) — rendering
- [Zod](https://zod.dev/) — `WorldSpec` schema + validation
- [Vite](https://vite.dev/) — web app bundler/dev server
- [Vitest](https://vitest.dev/) — testing
- [Oxlint](https://oxc.rs/) + [Oxfmt](https://oxc.rs/) — lint/format
- [Changesets](https://github.com/changesets/changesets) — versioning

## License

MIT
