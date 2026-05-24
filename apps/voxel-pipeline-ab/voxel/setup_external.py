"""Clone & install the external GPU tools (ComfyUI, TripoSR, TRELLIS).

All are large third-party repos, so they live under the gitignored
``.local/repos`` at the monorepo root rather than inside this app. Model weights
are multi-GB and gated — this script prints the download steps but does not
fetch them automatically.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from .paths import external_repos_dir

COMFYUI_URL = "https://github.com/comfyanonymous/ComfyUI"
TRIPOSR_URL = "https://github.com/VAST-AI-Research/TripoSR"
TRELLIS_URL = "https://github.com/microsoft/TRELLIS"

COMFYUI_NEXT_STEPS = """\
ComfyUI cloned. Next:
  1. Install its deps into this app's venv:
       uv pip install -r {path}/requirements.txt
  2. Start it:        python {path}/main.py --listen 127.0.0.1 --port 8188
  3. Models (8 GB-VRAM budget) -> {path}/models/:
       - checkpoints/sd_xl_base_1.0.safetensors  (SDXL 1.0 base, ~6 GB)
       - checkpoints/sd_xl_turbo_1.0_fp16.safetensors  (fast dev iteration)
       - loras/<voxel-isometric>.safetensors  (CivitAI: search "voxel isometric")
  4. The reusable workflow lives at apps/voxel-pipeline-ab/workflows/obj-concept.json
"""

# TripoSR's requirements.txt pins torchmcubes (compiles a CUDA/C++ extension that
# needs nvcc + VC++ build tools) and rembg (drags in onnxruntime + numba). We
# install the lean working set instead and shim both at runtime
# (voxel/triposr_infer.py): marching cubes -> scikit-image, rembg -> no-op.
# transformers is pinned to TripoSR's tested version so the checkpoint's ViT
# layer names match.
TRIPOSR_DEPS = ["transformers==4.35.0", "einops", "omegaconf", "scikit-image"]

TRIPOSR_NEXT_STEPS = """\
TripoSR cloned & its lean dependency set installed. Notes:
  - TripoSR ships no setup.py, so it is NOT pip-installed; triposr_infer.py adds
    the repo root to sys.path at runtime.
  - `torchmcubes` (compiled CUDA/C++) and `rembg` are NOT installed — both are
    shimmed at runtime (marching cubes -> scikit-image; rembg -> no-op). Install
    the real packages only if you want CUDA marching cubes / auto background removal.
  - transformers is pinned to 4.35.0 so the checkpoint's ViT keys match. NOTE: if
    you run ComfyUI from this same venv, that pin may be older than ComfyUI wants
    — consider a separate venv for ComfyUI if you hit issues.
  - Weights download from Hugging Face (stabilityai/TripoSR) on first inference;
    set HF_HOME to a roomy drive if your home drive is tight.
  - Test:  python -m voxel.triposr_infer <image.png> -o staging/test/mesh.obj --no-remove-bg
"""


# TRELLIS pulls in many GPU deps, but we only run the *mesh* format and read its
# vertex colors directly (see voxel/trellis_infer.py), so we skip the compiled
# rendering ops (nvdiffrast / diff-gaussian-rasterization / kaolin) used only by
# the Gaussian / radiance-field / textured-GLB paths. These pure deps are safe
# to install; the GPU wheels (spconv, xformers) are version-matched to your
# torch, so we print those rather than guess.
TRELLIS_PURE_DEPS = [
    "easydict",
    "einops",
    "utils3d @ git+https://github.com/EasternJournalist/utils3d.git",
]

TRELLIS_NEXT_STEPS = """\
TRELLIS cloned & its pure-Python deps installed. To finish (GPU-specific):

  1. Sparse-conv + attention wheels, matched to this venv's torch/CUDA:
       uv pip install spconv-cu120          # CUDA 12.x sparse conv (prebuilt)
       uv pip install xformers              # must match your torch version
     (We set ATTN_BACKEND=xformers / SPCONV_ALGO=native — no flash-attn build.)

  2. Background removal for TRELLIS's preprocess step (optional):
       uv pip install rembg onnxruntime
     ...or always pass --no-remove-bg / --no-preprocess to skip it.

  3. TRELLIS is run from source (repo root added to sys.path at runtime), like
     TripoSR. Weights auto-download from HF (microsoft/TRELLIS-image-large) on
     first run; set HF_HOME to a roomy drive.

CAVEATS:
  - VRAM: upstream TRELLIS targets >=16 GB. On the 8 GB 4070 this may OOM. We
    already request formats=['mesh'] only (skips Gaussian/RF decoders). If you
    still OOM: lower --ss-steps/--slat-steps, try --half (experimental), use the
    fp16 community fork (off-by-some/TRELLIS-BOX), or run on cloud.
  - transformers: TRELLIS's DINOv2 image encoder wants a newer transformers than
    TripoSR's pinned 4.35.0. Sharing one venv can conflict — if imports break,
    give TRELLIS its own venv.
  - If `import trellis.pipelines` fails on a missing render op (nvdiffrast /
    diff_gaussian_rasterization), those belong to the Gaussian/RF/textured paths
    we don't use; install the prebuilt community wheels or guard those imports.

  Test:  python -m voxel.trellis_infer <image.png> -o staging/test/mesh.glb --no-preprocess
"""


def _run(cmd: list[str]) -> None:
    print("$ " + " ".join(cmd), file=sys.stderr)
    subprocess.run(cmd, check=True)


def _clone(url: str, dest: Path) -> bool:
    if dest.exists():
        print(f"{dest} already exists; skipping clone", file=sys.stderr)
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    _run(["git", "clone", "--depth", "1", url, str(dest)])
    return True


def setup_comfyui() -> Path:
    dest = external_repos_dir() / "ComfyUI"
    _clone(COMFYUI_URL, dest)
    print(COMFYUI_NEXT_STEPS.format(path=dest), file=sys.stderr)
    return dest


def setup_triposr() -> Path:
    dest = external_repos_dir() / "TripoSR"
    _clone(TRIPOSR_URL, dest)
    # Install the lean working set (see TRIPOSR_DEPS) rather than the repo's
    # requirements.txt, which pins torchmcubes/rembg that we shim at runtime.
    _run(["uv", "pip", "install", *TRIPOSR_DEPS])
    print(TRIPOSR_NEXT_STEPS, file=sys.stderr)
    return dest


def setup_trellis() -> Path:
    dest = external_repos_dir() / "TRELLIS"
    _clone(TRELLIS_URL, dest)
    # Only the pure-Python deps; the GPU wheels (spconv/xformers) are printed
    # since they must match the installed torch/CUDA. See TRELLIS_NEXT_STEPS.
    _run(["uv", "pip", "install", *TRELLIS_PURE_DEPS])
    print(TRELLIS_NEXT_STEPS, file=sys.stderr)
    return dest


def _main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Clone/install ComfyUI, TripoSR, or TRELLIS.")
    ap.add_argument("target", choices=("comfyui", "triposr", "trellis", "all"))
    args = ap.parse_args(argv)

    if args.target in ("comfyui", "all"):
        setup_comfyui()
    if args.target in ("triposr", "all"):
        setup_triposr()
    if args.target in ("trellis", "all"):
        setup_trellis()
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
