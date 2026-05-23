"""Path B step 2 — TripoSR image -> mesh inference (CUDA).

Loads the TripoSR system, runs a single concept image through it, and exports a
mesh (``.obj`` with vertex colors) for the voxelizer. Sized for the 8 GB RTX
4070: half precision + a bounded renderer chunk size keep peak VRAM ~4 GB.

Requires the TripoSR package (``tsr``) on the path — install it with
``pnpm triposr:setup`` (clones VAST-AI-Research/TripoSR into ``.local/repos`` and
``uv pip install -e`` it). Model weights download from Hugging Face on first run.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional

TRIPOSR_HINT = (
    "TripoSR is not installed. Run `pnpm triposr:setup` (or "
    "`python -m voxel.setup_external triposr`) to clone and install it."
)


def _ensure_tsr_on_path() -> None:
    """Add the cloned TripoSR repo root to sys.path (it ships no setup.py)."""
    import sys

    from .paths import external_repos_dir

    repo = external_repos_dir() / "TripoSR"
    if repo.exists() and str(repo) not in sys.path:
        sys.path.insert(0, str(repo))


def _load_model(device: str, chunk_size: int, half: bool):
    _ensure_tsr_on_path()
    try:
        import torch
        from tsr.system import TSR
    except ImportError as exc:  # pragma: no cover - depends on external install
        raise SystemExit(f"{TRIPOSR_HINT}\n(import error: {exc})")

    model = TSR.from_pretrained(
        "stabilityai/TripoSR",
        config_name="config.yaml",
        weight_name="model.ckpt",
    )
    model.renderer.set_chunk_size(chunk_size)
    model.to(device)
    if half and device.startswith("cuda"):
        # half precision trims VRAM; keep the marching-cubes head in fp32.
        try:
            model.image_tokenizer.half()
            model.tokenizer.half()
            model.backbone.half()
        except Exception:  # noqa: BLE001 — not all submodules support .half()
            pass
    return model, torch


def _preprocess(image_path: str, remove_bg: bool, foreground_ratio: float):
    from PIL import Image

    image = Image.open(image_path).convert("RGB")
    if remove_bg:
        try:
            import numpy as np
            import rembg
            from tsr.utils import remove_background, resize_foreground

            session = rembg.new_session()
            image = remove_background(image, session)
            image = resize_foreground(image, foreground_ratio)
            # composite onto neutral gray so the model sees no alpha
            arr = np.array(image).astype("float32") / 255.0
            arr = arr[:, :, :3] * arr[:, :, 3:4] + 0.5 * (1 - arr[:, :, 3:4])
            image = Image.fromarray((arr * 255.0).astype("uint8"))
        except ImportError:
            print("rembg not installed; skipping background removal", file=sys.stderr)
    return image


def infer(
    image_path: str,
    out_path: str,
    *,
    device: str = "cuda",
    resolution: int = 256,
    chunk_size: int = 8192,
    half: bool = True,
    remove_bg: bool = True,
    foreground_ratio: float = 0.85,
) -> Path:
    model, torch = _load_model(device, chunk_size, half)
    image = _preprocess(image_path, remove_bg, foreground_ratio)

    with torch.no_grad():
        scene_codes = model([image], device=device)
    meshes = model.extract_mesh(scene_codes, resolution=resolution)
    mesh = meshes[0]

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(str(out))
    return out


def _main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="TripoSR image -> mesh (CUDA).")
    ap.add_argument("image", help="input concept image (front view)")
    ap.add_argument("-o", "--out", required=True, help="output mesh path (.obj/.glb)")
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--resolution", type=int, default=256, help="marching-cubes grid")
    ap.add_argument("--chunk-size", type=int, default=8192, help="renderer chunk (VRAM)")
    ap.add_argument("--no-half", action="store_true", help="run full fp32")
    ap.add_argument("--no-remove-bg", action="store_true")
    args = ap.parse_args(argv)

    out = infer(
        args.image,
        args.out,
        device=args.device,
        resolution=args.resolution,
        chunk_size=args.chunk_size,
        half=not args.no_half,
        remove_bg=not args.no_remove_bg,
    )
    print(f"wrote {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
