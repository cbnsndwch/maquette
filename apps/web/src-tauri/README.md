# Musicologia desktop (Tauri) target

Wraps the **same** Vite + Three.js frontend (`apps/web`) in a Tauri 2 window, so
the desktop app and the browser app render identical worlds from one codebase.
This is the second render target in the browser · Tauri · terminal plan.

## Prerequisites (one-time)

Tauri needs the **Rust toolchain** and the Tauri CLI — neither ships with the JS
workspace, so the desktop binary is not built by `pnpm build`.

```bash
# 1. Rust (https://rustup.rs) + your OS webview deps (see tauri.app prerequisites)
# 2. Tauri tooling in the web app:
pnpm --filter web add -D @tauri-apps/cli @tauri-apps/api
# 3. App icons (required by the bundler):
pnpm --filter web tauri icon path/to/logo.png
```

## Run / build

```bash
pnpm --filter web tauri dev     # hot-reloads against the Vite dev server (:5173)
pnpm --filter web tauri build   # produces a native installer
```

`tauri.conf.json` already points `frontendDist` at `../dist` and runs
`pnpm build` / `pnpm dev` for you.

## Loading local assets

WebGL works across platforms, but a Tauri webview can't `fetch('/assets/x')`
directly. The frontend exposes `assetUrl()` from `@cbnsndwch/world-core`; install
Tauri's resolver once at startup so every asset path is rewritten correctly:

```ts
import { setAssetResolver } from '@cbnsndwch/world-core';
import { convertFileSrc } from '@tauri-apps/api/core';

if ('__TAURI_INTERNALS__' in window) {
    setAssetResolver(convertFileSrc);
}
```

In the browser the default pass-through resolver is used, so no branching leaks
into the renderer.

## Notes

- Pin the Tauri version and CI-test all three OSes — older webviews had WebGL2
  gaps (tauri-apps/tauri#2866).
- `src/` here is Rust (the thin native shell); the UI lives in `apps/web/src`.
