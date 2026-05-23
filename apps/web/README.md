# web

Musicologia's browser render target: a [Vite](https://vite.dev/) +
[Three.js](https://threejs.org/) app that renders a `WorldSpec` produced by
`@cbnsndwch/contracts` through `@cbnsndwch/world-core`.

## Develop

From the repo root (builds the workspace libs first, then starts Vite):

```bash
pnpm dev
# or, explicitly: pnpm exec turbo run dev --filter=web
```

Or from this directory once the libs are built (`pnpm build` at the root):

```bash
pnpm dev
```

Open the printed local URL. Pass a custom seed with `?seed=<track-id>` to
generate a different world, e.g. `http://localhost:5173/?seed=spotify:track:xyz`.

## Build

```bash
pnpm build --filter=web
```
