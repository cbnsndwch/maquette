# voxel-pipeline-ab

Local CUDA voxel pipeline (Plan A+B). Generates palette-matched voxel props on a
fixed **12×12×H** grid for the Musicologia biome system, with no per-asset cost
beyond the optional text→image step. Two paths feed the same `VoxelUnit` schema:

- **Path A — LLM-native JSON voxels.** A frontier LLM emits the voxel grid
  directly as JSON. Low-barrier, best for architectural/geometric props. Falls
  back to a procedural skeleton when offline.
- **Path B — image → mesh → voxels.** ComfyUI renders an isometric voxel concept
  image, TripoSR turns it into a mesh, and the voxelizer rasterizes it into the
  grid with Lab-space palette quantization and a chunk-merge pass for the
  variable-block-size look.

The canonical output type is `VoxelUnit` (TS contract in
`libs/contracts/src/voxel-unit.mts`, Python mirror in `voxel/schema.py`). The
`.vox` (MagicaVoxel) export is a derived serialization for the Three.js renderer.

## Hardware target

NVIDIA RTX 4070 Laptop (Ada, 8 GB), CUDA 12.x. All model choices are sized for
the 8 GB VRAM budget.

## Setup

Requires [`uv`](https://docs.astral.sh/uv/) and an NVIDIA CUDA driver. The Python
environment is **self-contained** in `apps/voxel-pipeline-ab/.venv`.

```bash
pnpm setup        # uv venv .venv (py3.11) + install requirements + CUDA torch
pnpm doctor       # verify python / torch+CUDA / deps / external repos
```

`pnpm setup` installs the pure-Python deps from `requirements.txt` and the CUDA
build of torch from `requirements-cuda.txt` (cu121 wheels).

## Usage

```bash
# Path A (default) — LLM JSON voxels, or skeleton fallback when offline:
pnpm voxel:gen --desc "Olive tree, gnarled trunk" --biome mykonos

# Path B — full image→mesh→voxel chain (needs ComfyUI running + TripoSR installed):
pnpm voxel:gen --desc "Domed white chapel" --biome mykonos --path-b

# Path B from an existing image (skip ComfyUI) or mesh (skip ComfyUI + TripoSR):
pnpm voxel:gen --desc "Chapel" --path-b --image staging/chapel/concept.png
pnpm voxel:gen --desc "Chapel" --path-b --mesh staging/chapel/mesh.obj
```

Each run writes `out/<id>.json` (the `VoxelUnit`) and `out/<id>.vox`.

Path A uses a frontier LLM via the Anthropic SDK. The model id is read from the
environment and never hardcoded:

```bash
export ANTHROPIC_API_KEY=sk-...
export VOXEL_LLM_MODEL=<model-id>
```

Without those, Path A deterministically falls back to the nearest procedural
skeleton, so the CLI always produces a usable unit.

### Individual stages

| Command | Stage |
|---|---|
| `pnpm voxel:llm --desc "..."` | Path A LLM generation only |
| `pnpm voxel:validate <unit.json> --palette mykonos` | validate / normalize a unit |
| `pnpm voxel:triposr <image> -o mesh.obj` | TripoSR image → mesh (CUDA) |
| `pnpm voxel:voxelize <mesh> -o unit.json` | mesh → `VoxelUnit` |
| `pnpm voxel:chunk-merge <unit.json>` | greedy 3D block merge |
| `pnpm voxel:export-vox <unit.json> -o out.vox` | `VoxelUnit` → `.vox` |
| `pnpm voxel:skeletons` | regenerate the Path A skeleton JSON library |
| `pnpm voxel:bake [--all]` | bake skeletons → committed `.vox` asset cache + manifest |
| `pnpm voxel:remap <in.vox> --from <pal> --to <pal> -o out.vox` | re-skin a `.vox` to another biome palette |
| `pnpm bench` | benchmark the runnable stages (target < 30 s/asset) |
| `pnpm py:test` | run the pytest suite |

## Web integration (Phase 4)

The shared renderer (`@cbnsndwch/world-core`) decodes the pipeline's `.vox` into
its existing `Voxel` vocabulary — no new dependency. The footprint is fixed at
**12 voxels = 1 tile**, matching the biome's `perTile`, so a baked prop drops
straight into the instanced batcher.

- `decodeVox(buffer)` / `loadVoxAsset(url)` — parse a `.vox` into renderer voxels.
- `voxelUnitToVoxels(unit, paletteMap)` — palette-agnostic re-skin path.
- `VoxAssetCache` + `withVoxAssets(renderer, cache)` — preload a manifest once,
  then wrap a biome so its props resolve from baked assets first.

A curated starter set is committed to `apps/web/public/assets/voxels/` (with a
`manifest.json`). The web app loads it on demand:

```
# in apps/web — overlays baked hero props onto matching prop ids:
pnpm dev   # then open  http://localhost:5173/?biome=mykonos&voxassets=1
```

### External GPU tools (Path B)

ComfyUI and TripoSR are large third-party repos; they are cloned into the
gitignored `.local/repos/` at the monorepo root:

```bash
pnpm comfyui:setup    # clone ComfyUI + print model-download steps
pnpm triposr:setup    # clone + editable-install TripoSR
```

Models (SDXL 1.0 base / SDXL Turbo / a voxel-isometric LoRA from CivitAI) are
multi-GB and downloaded manually — `pnpm comfyui:setup` prints the exact paths.
The reusable ComfyUI workflow is `workflows/obj-concept.json` (512×512 for dev;
bump to 1024 or switch to SDXL Turbo as VRAM allows).

## Layout

```
voxel/                 Python pipeline package
  schema.py            VoxelUnit (mirror of the TS contract)
  palette.py           named-slot palettes + CIE-Lab quantization
  skeletons.py         Path A procedural skeleton library
  llm_voxels.py        Path A LLM generation (retry + skeleton fallback)
  validate_unit.py     tolerant parse / normalize / stats
  comfy.py             ComfyUI HTTP client (stdlib only)
  triposr_infer.py     TripoSR image → mesh (CUDA)
  voxelize.py          mesh → 12×12×H grid
  chunk_merge.py       greedy 3D block-merge pass
  export_vox.py        VoxelUnit → MagicaVoxel .vox
  gen.py               end-to-end CLI orchestrator
  doctor.py            environment diagnostics
  setup_external.py    clone/install ComfyUI + TripoSR
palettes/              named-slot biome palettes (mykonos.json)
skeletons/             committed Path A skeleton JSON
workflows/             ComfyUI API-format workflows
tests/                 pytest suite (pure-Python; no GPU required)
.venv/                 self-contained Python env (gitignored)
out/  staging/         generated artifacts / intermediates (gitignored)
```

## Notes / deviations from the plan

- The venv lives at `apps/voxel-pipeline-ab/.venv` (contained to this app),
  rather than `.local/venv-voxel`.
- The dev CLI is a Python module (`python -m voxel.gen`, exposed as
  `pnpm voxel:gen`) instead of a `tsx` script — the orchestration is all
  Python-side, so a single runtime is simpler.
- The shared `VoxelUnit` schema lives in `libs/contracts` (consumed by the biome
  renderer); the pipeline itself is fully contained in this app.
- This app intentionally defines no `build`/`typecheck`/`test` npm scripts, so it
  is skipped by the monorepo's Turborepo task graph; use `pnpm py:test` here.

## Status vs. the plan

- **Phases 1.1, 1.4, 2, 3.3–3.5, 4, 5** — implemented and tested (pytest +
  cross-language `.vox` decode in `@cbnsndwch/world-core`).
- **Phase 1.2/1.3 (ComfyUI + TripoSR)** — both repos clone into `.local/repos`
  via `pnpm comfyui:setup` / `pnpm triposr:setup`. Their heavy dependency installs
  and the multi-GB model downloads (SDXL, the voxel LoRA, TripoSR weights) are
  left as manual steps: TripoSR's `torchmcubes` compiles a CUDA/C++ extension
  (needs the VC++ build tools + nvcc), and the model/LoRA downloads are large/
  gated. The inference scripts, the ComfyUI workflow, and the runtime sys.path
  wiring are all in place for a machine with those prerequisites.
- **Path B end-to-end** is exercised in tests from a synthetic mesh (the
  `mesh → voxel → merge → .vox` tail); the GPU front-half is the only manual part.
