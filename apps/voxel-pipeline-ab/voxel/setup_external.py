"""Clone & install the external GPU tools (ComfyUI, TripoSR).

Both are large third-party repos, so they live under the gitignored
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

TRIPOSR_NEXT_STEPS = """\
TripoSR cloned & its requirements installed. Notes:
  - TripoSR ships no setup.py, so it is NOT pip-installed; triposr_infer.py adds
    the repo root to sys.path at runtime instead.
  - `torchmcubes` (a requirement) compiles a CUDA/C++ extension — it needs the
    Visual C++ build tools + CUDA toolkit (nvcc). If that build failed above,
    install those and re-run, or run marching cubes on CPU.
  - Weights download from Hugging Face (stabilityai/TripoSR) on first inference.
  - Background removal is optional: `uv pip install rembg onnxruntime`.
  - Test:  python -m voxel.triposr_infer <image.png> -o staging/test/mesh.obj
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
    # TripoSR has no setup.py/pyproject; install its requirements (the package
    # itself is imported via a runtime sys.path injection in triposr_infer.py).
    req = dest / "requirements.txt"
    if req.exists():
        _run(["uv", "pip", "install", "-r", str(req)])
    print(TRIPOSR_NEXT_STEPS, file=sys.stderr)
    return dest


def _main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Clone/install ComfyUI or TripoSR.")
    ap.add_argument("target", choices=("comfyui", "triposr", "all"))
    args = ap.parse_args(argv)

    if args.target in ("comfyui", "all"):
        setup_comfyui()
    if args.target in ("triposr", "all"):
        setup_triposr()
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
