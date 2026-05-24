# Rearchitect `apps/three-scene` chrome to React (engine stays imperative)

## Context

`apps/three-scene` (the Three.js voxel scene / tile builder, ~4,250 LOC) has grown
hard to maintain. The pain is **not** in the 3D engine — it is in the 2D "chrome"
(`src/ui/*`, ~1,400 LOC): UI is built by string-concatenated `innerHTML`
(`editor-panel.ts` is one ~120-line template with **41** ID-based `querySelector`
lookups), and state→DOM sync is a hand-rolled fan-out (`editor.onChange` →
`editorPanel.refresh() + editorColors.refresh() + contextMenu.refresh()`, each
re-touching every node it owns; `editor-colors.refresh()` loops all **256** swatches
on any edit). This is brittle and resists static analysis.

**Decision:** migrate the chrome to **React**, keeping the Three.js engine **100%
imperative and untouched** (no react-three-fiber — that reconciler-over-scene-graph
pattern is the source of the perf concern, and we avoid it entirely). React only ever
touches chrome DOM; the canvas mounts via a ref and never unmounts.

The 3D engine (`Game`, `SceneView`, `TileEditor`, `Input`, `TileMap`,
`PlacementSystem`, `History`, `VoxelAssets`, `thumbnails`) is kept as-is. Only
`src/ui/*`, `src/main.ts` wiring, and `core/router.ts` (deleted — replaced by RR7) change.

> Note: this reverses the earlier "three-scene stays vanilla / framework-free" and
> "route with the Navigation API" decisions — both intentionally, at the user's request.

### Stack decisions (settled)

- **Routing:** React Router 7 in **library/data mode** (`createBrowserRouter` +
  `<RouterProvider>`). **Not** framework mode — no SSR, no `@react-router/dev` Vite plugin.
- **UI primitives + styling:** **shadcn/ui on Base UI primitives** + **Tailwind CSS v4**.
  Base UI is the confirmed primitives layer — **not Radix** (Radix has unaddressed issues;
  its maintainers have moved to Base UI). Decompose the current CSS into Tailwind utilities
  applied to Base UI components to match today's look; use Tailwind `@apply` semantic classes
  **only as the exception** (likely just the 256-swatch grid).
- **State bridge:** DIY `useSyncExternalStore` over the engine (a version counter).
  **Not Zustand** — see rationale below.
- **Toasts:** **Sonner** + global `<Toaster/>` (replaces the hand-rolled `showToast`);
  Sonner's imperative `toast()` is callable from outside React, so the engine can fire toasts.
- **Tooltips:** shadcn Tooltip (Base UI) + a single global `<TooltipProvider>`.

## Architecture

**One source of truth = the engine.** React reads engine state through a tiny external
store and calls engine **intent methods** (`game.setTool`, `editor.setSlotColor`, …)
for actions. No engine state is duplicated into React.

### State management: DIY `useSyncExternalStore`, not Zustand (perf-driven)

Zustand is **unnecessary overhead here**, and the perf is identical to DIY either way:
- The engine owns **mutable** state imperatively — `voxels` is `.push`-ed per
  pointer-move during paint strokes; `selection` is a `Set` mutated in place (identity
  **never** changes); the render loop/raycaster read it every frame. This cannot move
  into a React-owned store without routing the hot path through React. So engine state
  stays in the engine **regardless** — the only question is the notification bridge.
- Zustand **is** `useSyncExternalStore` underneath; a narrow `useStore(selector)` and a
  narrow DIY selector re-render under identical conditions and cost. No perf delta.
- Zustand wants immutable `set()`; the engine mutates in place → you'd either duplicate
  state (sync bugs) or degrade Zustand to a notify-shim (a dep + a second source of
  truth temptation). Both are worse.
- Undo/redo already exists (`core/history.ts`, snapshot-based), so the store's
  devtools/time-travel argument doesn't apply.

**The bridge (single version counter):**
```
// src/store.ts  (bootstrap-owned, NOT in core/)
let version = 0;
const listeners = new Set<() => void>();
const emit = () => { version++; listeners.forEach(l => l()); };
export const engineStore = {
    subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
    getVersion: () => version,
};
```
- In the bootstrap, route the engine's existing callbacks into `emit` (preserves the
  single-callback contract, **zero `core/` changes**):
  ```
  editor.onChange = emit;
  game.ui = { update: emit, showToast: (m) => toast(m) };  // toast() from sonner — callable outside React
  ```
  This deletes the old `main.ts` `*.refresh()` fan-out entirely.
- A ~10-line `useEngineSelector(selector, isEqual?)` helper wraps
  `useSyncExternalStore(subscribe, getVersion)` for ergonomics. Components read **live
  engine fields** (don't snapshot the mutable `voxels`/`palette`/`selection` — read
  scalars: `selection.size`, `voxels.length`, `tool`, `floorOffset`, …, which is what
  the old `refresh()` already read). `React.memo` + primitive selectors → minimal,
  correct re-renders. **Do NOT add the `use-sync-external-store` package** (React <18 shim).
- **Engine state vs React-only UI state — keep them separate.** Accordion open/close,
  popover open/close, the hex-input editing buffer, etc. are **local `useState`** (or a
  primitive's internal state), **never** routed through the engine bridge. The bridge is
  only for reading *engine* facts.
- **Perf escape hatch (only if profiling demands):** split `emit` into channels
  (`emit('palette')` vs `emit('voxels')`) so the 256 swatch selectors don't re-run on
  voxel adds. Default to the single counter — it's almost certainly fine (256 trivial
  compares, 0 re-renders, on a non-palette change).

### Engine singleton + canvas mount (WebGL-context safety — top risk)

- Create all engine instances **once** in `src/bootstrap.ts` (extracted from `main.ts`),
  exported as a module singleton, guarded with `import.meta.hot` accept/dispose so HMR
  reuses it. React imports the singleton (`import { engine } from './bootstrap.js'`) —
  a plain module export is simpler than Context and sidesteps context-churn re-renders.
- `<SceneCanvas/>` lives in the **RR7 root layout route** so it mounts once and never
  unmounts as child routes swap. Its `useEffect` only `appendChild`s the existing
  `sceneView.renderer.domElement` and `removeChild`s on cleanup — it **never creates or
  disposes** the renderer, so StrictMode's double mount/unmount is harmless.
- **Add a real `SceneView.dispose()`** (`scene-view.ts`) — the one endorsed engine
  change, additive: `renderer.setAnimationLoop(null)`, remove the resize listener (hoist
  the currently-anonymous handler at `scene-view.ts:134` to a named bound method),
  `renderer.dispose()` + `forceContextLoss()`. Without it, dev sessions leak WebGL
  contexts after ~15 hot reloads and the browser silently kills the scene.

### Routing: React Router 7 (library/data mode)

Loaders run **once per navigation** and are **not** StrictMode double-invoked — so they
are the home for the per-navigation **imperative engine intents** (better than a
StrictMode-unsafe `useEffect`). The persistent canvas lives in the layout route.

```
createBrowserRouter([{
  path: '/',
  element: <RootLayout/>,   // <SceneCanvas/> (persistent) + <Toaster/> + <TooltipProvider/> + <Outlet/>
  children: [
    { index: true,        loader: () => { game.setMode('build'); sceneView.invalidateTerrain(); sceneView.syncTerrain(); return null; },        element: <BuildChrome/> },
    { path: 'tile',       loader: () => { game.setMode('edit'); editor.reset(); return { def: null }; },                                          element: <EditorChrome/> },
    { path: 'tile/:id',   loader: ({params}) => { const def = ASSET_INDEX[params.id!]; if(!def) throw redirect('/tile');
                                                  game.setMode('edit'); editor.loadTile(assets.get(def.id), def.id, assets.palette(def.id)); return { def }; }, element: <EditorChrome/> },
    { path: 'inspect',    loader: () => { game.setMode('build'); return null; },                                                                  element: <InspectOverlay/> },
  ],
}]);
```
- `/tile/:id` not-found guard → `throw redirect('/tile')` (replaces imperative navigate).
- Save-form initial values come from `useLoaderData().def` (replaces `loadMeta`/`resetMeta`).
- `useNavigate()` / `<Link>` replace `router.navigate`. **Delete `core/router.ts`.**
- Caveat (accepted): driving engine side-effects from loaders is mildly against their
  "pure fetch" intent, but for a client-only SPA over a singleton engine it's the
  canonical imperative-integration pattern and strictly better than a double-invoked effect.

### Component decomposition (`src/ui/` → `.tsx`, shadcn + Base UI)

| Old (`src/ui/*.ts`) | New React (primitive) |
|---|---|
| `toolbar.ts` | `<Toolbar/>` — shadcn Button / ToggleGroup; Tooltip per button (migrate first) |
| `palette.ts` | `<Palette/>` + `<Swatch/>` — shadcn Accordion (Base UI) |
| `editor-panel.ts` | `<EditorPanel/>` split into 7 sections in shadcn Accordion; Save form = shadcn Input/Select/Checkbox |
| `editor-colors.ts` | `<ColorPalette/>` + memoized `<ColorSwatch/>` + `<ColorPopover/>` (shadcn Popover) |
| `edit-context-menu.ts` | `<EditContextMenu/>` — Base UI Menu/ContextMenu (cursor-anchored) |
| `inspector.ts` | `<Inspector/>` + `<TileDetailModal/>` — shadcn Dialog (Base UI) |
| toast div | Sonner `<Toaster/>` global + imperative `toast()` |
| (tooltips) | shadcn Tooltip + global `<TooltipProvider>` |

`thumbnails.ts` stays imperative; thumbnail data-URLs live in a bootstrap-owned
`Map<string,string>`, read by components; only the save intent triggers `renderThumbnail`
+ map update + `emit()`.

### Styling strategy

1. **Decompose the current CSS into Tailwind utilities** applied to Base UI components so
   the app looks the same (port `.ed-accordion`, `.swatch`, toolbar, panels, etc.).
2. **`@apply` semantic classes only where utilities are impractical** (complex
   pseudo-state combos, the 256-swatch grid layout) — the exception, not the rule.
- Keep visual parity with today; this is a re-platform, not a redesign.

## Phased migration (per-panel clean cutover; engine is shared truth so no dual-view)

- **Phase 0 — Tooling spike (GATE; before any UI).** Add React + RR7 + Tailwind v4 +
  shadcn(Base UI). Verify **all** of: Vite 8 Rolldown/Oxc JSX transform + React Fast
  Refresh; `@tailwindcss/vite` v4 under Vite 8; **a working shadcn + Base UI + Tailwind v4
  setup** (newer ground than shadcn's default Radix — validate the registry/components.json
  before relying on it); `createBrowserRouter` renders; `vite build` + `tsc --noEmit` +
  `oxlint` pass on a throwaway `<App/>` with one shadcn button + one route. React plugin
  (if needed) and Tailwind plugin ordering vs the existing `tilesController()`
  (`vite.config.ts:3,8`). **If any of these are broken under Vite 8, resolve before proceeding.**
- **Phase 1 — Bootstrap + store + RootLayout + `<SceneCanvas/>`, no panels.** Extract
  engine creation from `main.ts` into `bootstrap.ts` (HMR-guarded singleton). Build
  `engineStore` + `useEngineSelector`; wire `editor.onChange`/`game.ui` to `emit`/`toast`.
  Add `SceneView.dispose()`. Set up `createBrowserRouter` with the route tree + loaders;
  RootLayout mounts the persistent canvas, `<Toaster/>`, `<TooltipProvider/>`, `<Outlet/>`.
  Verify **no double WebGL context** in StrictMode and that navigations don't unmount the canvas.
- **Phase 2 — `<Toolbar/>`** (simplest; all-primitive selectors; validates the pattern + Tooltip).
- **Phase 3 — `<Palette/>` + `<Inspector/>`** (shadcn Accordion + Dialog).
- **Phase 4 — `<EditorPanel/>`** (7 sections; Save form via shadcn Input/Select/Checkbox;
  initial values from `useLoaderData().def`; controlled `name` via local `useState`,
  committed on save; `id` derivation stays in the save handler).
- **Phase 5 — `<ColorPalette/>` (256 swatches) + `<ColorPopover/>`.** Each `<ColorSwatch i>`
  is `React.memo`, reads only `palette[i]` + `i===activeColorIdx` (handle
  `noUncheckedIndexedAccess` → `palette[i]` is `string|null|undefined`). **Do NOT
  virtualize.** Likely the `@apply` exception for grid layout. Hex input commits on
  blur/Enter via a local editing buffer (per-keystroke reformatting causes cursor jumps);
  the native `<input type=color>` stays **uncontrolled** (read `.value` in `onChange`).
- **Phase 6 — `<EditContextMenu/>`** (Base UI Menu, cursor-anchored positioning math +
  window listeners; port with careful effect cleanup — fiddliest, lowest traffic, last).
- **Phase 7 — Cleanup.** Delete old `ui/*.ts`, `core/router.ts`, the `showChrome`/
  `style.display` logic, dead `game.onModeChange`; collapse the static panel shells in
  `index.html` to one React root.

## Tooling changes

- **Dependencies:** `react`, `react-dom`, `@types/react`, `@types/react-dom`;
  `react-router` (v7); `tailwindcss` v4 + `@tailwindcss/vite`; shadcn/ui (CLI-generated
  components into `src/components/ui/`) configured against **Base UI** primitives (not
  Radix); `sonner` for toasts (its imperative `toast()` lets the engine fire toasts
  without a React dep).
- `tsconfig.json`: add **only** `"jsx": "react-jsx"` (+ the `@/*` path alias shadcn
  expects, if used). **Do NOT** adopt `@cbnsndwch/tsconfig/react-library` — it flips
  `moduleResolution` to `NodeNext` and breaks this app's `"Bundler"` +
  explicit-`.js`-extension imports and `vite/client` types. Keep `module: ESNext`,
  `moduleResolution: Bundler`, `types: ["vite/client"]`.
- New files are `.tsx`, importing relatives with `.js` specifiers (matching existing
  convention, e.g. `./App.js` → `App.tsx`).
- `vite.config.ts`: add the React plugin (if Rolldown/Oxc doesn't cover Fast Refresh) +
  `@tailwindcss/vite`, before the existing `tilesController()`.
- `oxlint`: enable the `react` / `react-hooks` plugin categories (add/extend
  `.oxlintrc.json`) so `rules-of-hooks` and `exhaustive-deps` catch stale-closure bugs in
  StrictMode cleanup paths. (Confirm oxlint's react-hooks maturity; if weak, compensate
  with manual review of hook deps.)
- Tailwind/shadcn config files: `components.json` (Base UI registry), Tailwind v4 CSS
  entry (`@import "tailwindcss"` + `@theme`), the shadcn CSS variables for the app's palette.

## Critical files

- `apps/three-scene/src/main.ts` — split into `bootstrap.ts`; remove the `editor.onChange`/`game.ui` fan-out (lines 58-92), `showChrome`, and the route registration (159-214, now RR7 loaders).
- `apps/three-scene/src/core/scene-view.ts` — add `dispose()`; name the resize listener (134); `setAnimationLoop` at 135.
- `apps/three-scene/src/core/router.ts` — **deleted** (replaced by RR7).
- `apps/three-scene/src/core/tile-editor.ts` — unchanged; `onChange` is the source of truth; mind `voxels`/`palette`/`selection` identity (no snapshotting).
- `apps/three-scene/src/core/game.ts` — unchanged; `game.ui.update` → `emit`, `showToast` → `toast()`.
- `apps/three-scene/src/ui/*.ts` — replaced by `.tsx` components (table above).
- `apps/three-scene/src/ui/editor-colors.ts` — 256-swatch perf + commit-on-blur hex pattern (113-125, 75).
- `apps/three-scene/tsconfig.json` — add `jsx: react-jsx` (+ path alias) only.
- `apps/three-scene/vite.config.ts` — add React + Tailwind plugins (first), keep `tilesController()`.
- `apps/three-scene/package.json` — add React, RR7, Tailwind, shadcn/Base UI, toast deps.
- New: `src/bootstrap.ts`, `src/store.ts` (+ `useEngineSelector`), `src/router.tsx` (route tree + loaders), `src/App.tsx`, `src/routes/RootLayout.tsx`, `src/ui/*.tsx`, `src/components/ui/*` (shadcn), `components.json`, Tailwind CSS entry.

## Verification

- **Automated gates each phase:** `pnpm --filter three-scene typecheck` (`tsc --noEmit`),
  `pnpm --filter three-scene lint` (oxlint), `pnpm --filter three-scene build`
  (`vite build`), `pnpm format`.
- **Manual / browser (UI correctness needs a real browser — agent-browser if Chrome
  launches in-env, otherwise run `pnpm --filter three-scene dev`, port 8302):**
  golden paths —
  1. Build mode `/`: place / erase / pan / rotate / fill, undo/redo, grid toggle, save, export, reset; toolbar active states + rotation readout update; tooltips show.
  2. Palette: category accordions open/close; swatch selection highlights; selecting an asset updates the brush.
  3. Editor `/tile` and `/tile/:id`: all 7 sections; add/delete/paint/pick/select tools; fill base / hull; shade; floor raise/lower; grid/edges/explode/focus-layer; import `.vox`; save form (name/category/stackable) round-trips (initial from loader, save persists); toast on save.
  4. Color palette: edit a slot via popover (color + hex, commit on blur), clear slot, "Trim unused"; **no cursor jump** in hex; **no lag** during a drag-paint stroke (confirms 256-swatch memo).
  5. `/inspect`: tile library dialog, detail modal, Edit/Delete; Escape closes.
  6. Navigate `/ ↔ /tile ↔ /inspect` repeatedly — correct chrome mounts via `<Outlet/>`, **canvas never unmounts**, **no duplicate WebGL context**, no leaked listeners (DevTools); loaders fire once per navigation (no double `editor.reset()`).
- **HMR check:** edit a component ~20× in a dev session; confirm the scene keeps rendering
  (validates `SceneView.dispose()` + singleton guard).
