# tui — Musicologia terminal render target

Renders a track's generated island in the terminal. This is the **third render
target** in the multi-target plan (browser · Tauri · terminal), proving the same
`WorldSpec` drives every renderer.

The default renderer uses [`@opentui/three`](https://github.com/anomalyco/opentui)
— a WebGPU Three.js rasteriser that draws the **actual 3D scene** as 24-bit
partial-block characters and auto-orbits the camera. It requires Bun as the
runtime. A 2D block-map fallback (`renderAscii`) activates automatically when
the 3D runtime is unavailable, or can be forced with `--ascii` / `--glyph`.

```bash
pnpm --filter tui build

# 3D scene in the terminal (default, requires Bun)
bun apps/tui/dist/main.js "spotify:track:abc"
bun apps/tui/dist/main.js "spotify:track:abc" --biome=cyberpunk

# 2D block-map fallback (any runtime)
node apps/tui/dist/main.js "spotify:track:abc" --ascii
node apps/tui/dist/main.js "spotify:track:abc" --glyph

# use the LLM generation path (offline fake client by default)
bun apps/tui/dist/main.js "spotify:track:abc" --llm
```

Press `q` to quit the 3D renderer. The 2D renderer exits immediately.

Glyphs (2D `--glyph` mode): `~` water · `.` sand · `,` grass · `^` rock ·
`+` plaza · `-` path · `#` wall · `R` rooftop · `O` dome · `=` stairs;
props `T` tree · `i` lamp · `W` windmill · `b` boat · `*` other.

## Architecture

```
main.mts
  ├─ default → tryRender3d() → render3d.mts (ThreeCliRenderer + buildScene)
  │              falls back on any init error
  └─ --ascii / --glyph → renderAscii() (zero-dep, runs on Node)
```

`render3d.mts` wires `buildScene(spec)` + `suggestCameraPosition()` from
`@cbnsndwch/world-core` into a `ThreeCliRenderer` with a gentle auto-orbit.
`renderAscii` remains the reliable fallback when the WebGPU rasteriser is
unavailable.

## License

MIT © [cbnsndwch LLC](https://github.com/cbnsndwch)
