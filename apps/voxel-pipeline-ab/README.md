# voxel-pipeline-ab

Local CUDA voxel pipeline (Plan A+B). Generates palette-matched voxel props on a
fixed **12×12×H** grid for the Musicologia biome system, with no per-asset cost
beyond the optional text→image step. Two paths feed the same `VoxelUnit` schema:

- **Path A — LLM-native JSON voxels.** A frontier LLM emits the voxel grid
  directly as JSON. Low-barrier, best for architectural/geometric props. Falls
  back to a procedural skeleton when offline.
- **Path B — image → mesh → voxels.** ComfyUI renders an isometric voxel concept
  image, an image→mesh model turns it into a mesh, and the voxelizer rasterizes
  it into the grid with Lab-space palette quantization and a chunk-merge pass for
  the variable-block-size look. The mesh model is selectable with `--mesh-model`:
  - `triposr` (default) — fast, light (~4 GB), but low-fidelity blobs.
  - `trellis` — `microsoft/TRELLIS-image-large`: far cleaner, voxel-native
    geometry. We run `formats=['mesh']` only and read its per-vertex colors
    directly (no `to_glb`/nvdiffrast), so no compiler is needed — but it's a
    bigger install and 8 GB VRAM is below upstream's 16 GB target (see caveats).

The canonical output type is `VoxelUnit` (TS contract in
`libs/contracts/src/voxel-unit.mts`, Python mirror in `voxel/schema.py`). The
`.vox` (MagicaVoxel) export is a derived serialization for the Three.js renderer.

> **New here?** Start with [QUICKSTART.md](./QUICKSTART.md) — clean checkout to a
> rendered prop in a few minutes. This README is the full reference.

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

# Path B with the cleaner TRELLIS image→mesh model (needs `pnpm trellis:setup`):
pnpm voxel:gen --desc "Olive tree" --biome mykonos --path-b --mesh-model trellis

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
| `pnpm voxel:trellis <image> -o mesh.glb` | TRELLIS image → mesh, vertex-colored (CUDA) |
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
pnpm dev   # then open  http://localhost:8301/?biome=mykonos&voxassets=1
```

### External GPU tools (Path B)

ComfyUI and TripoSR are large third-party repos; they are cloned into the
gitignored `.local/repos/` at the monorepo root:

```bash
pnpm comfyui:setup    # clone ComfyUI + print model-download steps
pnpm triposr:setup    # clone + editable-install TripoSR
pnpm trellis:setup    # clone TRELLIS + install pure deps, print GPU-wheel steps
```

**TRELLIS specifics.** `trellis:setup` clones `microsoft/TRELLIS` and installs
its pure-Python deps, then prints the GPU-wheel steps it can't safely guess
(`spconv-cu120`, `xformers` matched to your torch). We default
`SPCONV_ALGO=native` and `ATTN_BACKEND=xformers` to avoid a flash-attn build,
and skip the compiled rendering ops (nvdiffrast / diff-gaussian-rasterization)
entirely by reading the FlexiCubes mesh's vertex colors instead of baking a
texture. Caveats: 8 GB VRAM is below upstream's 16 GB target (lower
`--ss-steps`/`--slat-steps`, try `--half`, or use a cloud/fp16 fork if you OOM),
and TRELLIS's DINOv2 encoder may want a newer `transformers` than TripoSR's
pinned 4.35.0 — give TRELLIS its own venv if the shared one conflicts.

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
  trellis_infer.py     TRELLIS image → mesh, vertex-colored (CUDA, no compiler)
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

All phases implemented and **run end-to-end on the RTX 4070** (SDXL Turbo →
TripoSR → voxelize → chunk-merge → `.vox`). Notes on the GPU front-half:

- **No compiler needed.** TripoSR's `torchmcubes` (compiled CUDA/C++, needs
  nvcc + VC++ build tools) is replaced at runtime by a **scikit-image** marching
  cubes shim; `rembg` is shimmed to a no-op (we keep backgrounds plain via the
  prompt, or remove them upstream). See `voxel/triposr_infer.py`.
- **transformers is pinned to 4.35.0** so the TripoSR checkpoint's ViT layer
  names match. `pnpm triposr:setup` installs the lean working set
  (`transformers==4.35.0 einops omegaconf scikit-image`), not the repo's
  `requirements.txt`.
- **Shared-venv caveat:** if you launch ComfyUI from this app's `.venv`, the
  transformers pin may be older than ComfyUI prefers. Core SDXL works; if a
  ComfyUI node needs newer transformers, run ComfyUI in its own venv.
- **Models** (SDXL/Turbo checkpoint, optional voxel LoRA, TripoSR weights) are
  multi-GB and downloaded separately; point `HF_HOME` / the ComfyUI `models/`
  dir at a roomy drive. TripoSR weights auto-download on first inference.
- The `mesh → voxel → merge → .vox` tail is also covered by the pytest suite
  using a synthetic mesh (no GPU required).
