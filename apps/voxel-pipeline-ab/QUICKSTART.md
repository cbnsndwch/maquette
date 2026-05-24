# Quickstart — voxel-pipeline-ab

Generate palette-matched voxel props (12×12×H) for the Musicologia biomes. This
gets you from a clean checkout to a rendered prop in a few minutes. Full
reference: [README.md](./README.md).

## 0. Prerequisites

- [`uv`](https://docs.astral.sh/uv/) (Python env manager)
- An NVIDIA CUDA driver (the env installs the cu121 torch build)
- `pnpm` (already used by the monorepo)

Everything Python lives in a self-contained `.venv` inside this folder.

## 1. Set up the environment

```bash
cd apps/voxel-pipeline-ab
pnpm setup     # uv venv .venv (py3.11) + deps + CUDA torch
pnpm doctor    # sanity check: python / torch+CUDA / deps
```

`pnpm doctor` should report `core pipeline ready` and `torch ... cuda=True`.

## 2. Generate your first prop (offline, no API key)

```bash
pnpm voxel:gen --desc "Olive tree, gnarled trunk" --biome mykonos
```

With no LLM configured this falls back to the nearest procedural skeleton, so it
always works. It writes:

- `out/olive-tree-gnarled-trunk.json` — the `VoxelUnit`
- `out/olive-tree-gnarled-trunk.vox` — MagicaVoxel binary for the renderer

## 3. See it in the web app

```bash
pnpm voxel:bake                       # bake the starter .vox set + manifest
                                      #   -> apps/web/public/assets/voxels/

cd ../web && pnpm dev                 # start the app
# open: http://localhost:8301/?biome=mykonos&voxassets=1
```

`?voxassets=1` overlays the baked hero props onto matching prop ids.

## 4. (Optional) Turn on the real generators

**Path A — LLM JSON voxels** (frontier model):

```bash
export ANTHROPIC_API_KEY=sk-...
export VOXEL_LLM_MODEL=<model-id>     # never hardcoded
pnpm voxel:gen --desc "Domed white chapel" --biome mykonos
```

**Path B — image → mesh → voxels** (ComfyUI + TripoSR; no compiler needed —
marching cubes runs via scikit-image, see the README):

```bash
pnpm comfyui:setup    # clone ComfyUI + print model-download steps
pnpm triposr:setup    # clone TripoSR + install its lean working deps

# point caches at a roomy drive if your home drive is tight:
export HF_HOME=.local/hf-cache

# start ComfyUI (a checkpoint must be in ComfyUI/models/checkpoints/), then:
# full chain — image (SDXL Turbo, no LoRA) → mesh → voxels:
pnpm voxel:gen --path-b --desc "a single olive tree" \
  --ckpt sd_xl_turbo_1.0_fp16.safetensors --no-lora --steps 4 --cfg 1.0 --no-remove-bg

# verify just the ComfyUI image step first (no TripoSR needed):
pnpm voxel:concept --desc "a single olive tree" \
  --ckpt sd_xl_turbo_1.0_fp16.safetensors --no-lora --steps 4 --cfg 1.0

# or resume from an image / mesh you already have:
pnpm voxel:gen --path-b --desc "Chapel" --image staging/chapel/views/concept.png
pnpm voxel:gen --path-b --desc "Chapel" --mesh  staging/chapel/mesh.obj
```

**Cleaner geometry — TRELLIS instead of TripoSR.** TripoSR is fast but blobby;
`microsoft/TRELLIS-image-large` gives far cleaner, voxel-native meshes. No
compiler needed (we read its vertex colors directly, skipping the
nvdiffrast-based texture bake), but it's a heavier install and 8 GB VRAM is
below upstream's 16 GB target.

```bash
pnpm trellis:setup    # clone TRELLIS + pure deps; prints the GPU-wheel steps
                      #   (spconv-cu120, xformers matched to your torch)

# same chain, swapping the image→mesh model:
pnpm voxel:gen --path-b --mesh-model trellis --desc "a single olive tree" \
  --ckpt sd_xl_turbo_1.0_fp16.safetensors --no-lora --steps 4 --cfg 1.0

# if you OOM on 8 GB: fewer steps and/or the experimental fp16 cast
pnpm voxel:gen --path-b --mesh-model trellis --desc "a single olive tree" \
  --ss-steps 8 --slat-steps 8 --half
```

Models (a SDXL/Turbo checkpoint, optional voxel LoRA, TripoSR weights) are
multi-GB. Download the checkpoint into `ComfyUI/models/checkpoints/` (TripoSR
weights auto-download on first run). `pnpm comfyui:setup` prints the paths.

## Common commands

| Command | What it does |
|---|---|
| `pnpm voxel:gen --desc "..."` | end-to-end: description → `.json` + `.vox` |
| `pnpm voxel:gen --path-b --mesh-model trellis --desc "..."` | Path B via TRELLIS (cleaner mesh) |
| `pnpm voxel:bake [--all]` | bake skeleton library → committed asset cache |
| `pnpm voxel:remap <in.vox> --from mykonos --to cyberpunk -o out.vox` | re-skin to another palette |
| `pnpm voxel:validate <unit.json> --palette mykonos` | validate / normalize a unit |
| `pnpm bench` | benchmark the runnable stages |
| `pnpm py:test` | run the test suite |
| `pnpm doctor` | environment diagnostics |
