"""Path B step 2 (alt) — TRELLIS image -> mesh inference (CUDA).

A drop-in alternative to :mod:`voxel.triposr_infer` with the same
``infer(image, out)`` contract, selected via ``--mesh-model trellis``. TRELLIS
(``microsoft/TRELLIS-image-large``) produces far cleaner geometry than TripoSR
and is voxel-native, so the downstream voxelization has real structure to bite
into instead of a blob.

Two choices keep this aligned with the app's no-compiler stance and 8 GB budget:

- **We read the mesh extractor's per-vertex colors directly** from
  ``MeshExtractResult.vertex_attrs`` and write a vertex-colored mesh for
  :mod:`voxel.voxelize`. We deliberately do **not** call
  ``postprocessing_utils.to_glb`` — that bakes a texture via ``nvdiffrast``
  (``dr.texture``), a compiled CUDA op we don't build (same wall that ruled out
  Stable Fast 3D). Mesh extraction itself uses FlexiCubes and needs no such op.
- **Only ``formats=['mesh']`` is requested**, so the Gaussian and radiance-field
  decoders never run — they're pure VRAM cost we don't need.

> VRAM note: upstream TRELLIS targets >=16 GB. On an 8 GB card this may OOM; see
> ``pnpm trellis:setup`` output for fallbacks (fewer steps, the fp16 community
> fork, or cloud). ``--half`` here is a best-effort cast and is experimental.

Requires the TRELLIS package on the path — ``pnpm trellis:setup``. Weights
download from Hugging Face on first inference (set ``HF_HOME`` to a roomy drive).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any, Optional

# TRELLIS reads these at import time, so set them before `trellis` is imported
# (the import is lazy, inside _load_pipeline). `native` spconv avoids a build
# step; `xformers` attention has prebuilt wheels (flash-attn would need nvcc).
os.environ.setdefault("SPCONV_ALGO", "native")
os.environ.setdefault("ATTN_BACKEND", "xformers")

TRELLIS_HINT = (
    "TRELLIS is not installed. Run `pnpm trellis:setup` (or "
    "`python -m voxel.setup_external trellis`) to clone and install it."
)


def _ensure_trellis_on_path() -> None:
    """Add the cloned TRELLIS repo root to sys.path (it's run from source)."""
    from .paths import external_repos_dir

    repo = external_repos_dir() / "TRELLIS"
    if repo.exists() and str(repo) not in sys.path:
        sys.path.insert(0, str(repo))


def _install_kaolin_shim() -> None:
    """Provide a tiny ``kaolin.utils.testing.check_tensor`` if kaolin is absent.

    TRELLIS's vendored FlexiCubes imports exactly one helper from kaolin —
    ``check_tensor`` — used only in shape asserts (always with ``throw=False``).
    Full kaolin has no prebuilt wheel for every torch/CUDA combo and otherwise
    needs a compiler, so where it's missing we register a stdlib shim with the
    same contract. Mirrors the ``torchmcubes``/``rembg`` shims in triposr_infer.
    """
    import types

    if "kaolin" in sys.modules:
        return
    try:
        import kaolin  # noqa: F401 — real package, if installed
        return
    except Exception:  # noqa: BLE001 — fall through to the shim
        pass

    def check_tensor(tensor, shape=None, dtype=None, throw=True, **_kw) -> bool:
        try:
            if shape is not None:
                if tensor.ndim != len(shape):
                    raise ValueError(f"ndim {tensor.ndim} != {len(shape)}")
                for actual, expected in zip(tensor.shape, shape):
                    if expected is not None and actual != expected:
                        raise ValueError(f"shape {tuple(tensor.shape)} != {shape}")
            if dtype is not None and tensor.dtype != dtype:
                raise ValueError(f"dtype {tensor.dtype} != {dtype}")
            return True
        except Exception:
            if throw:
                raise
            return False

    kaolin = types.ModuleType("kaolin")
    utils = types.ModuleType("kaolin.utils")
    testing = types.ModuleType("kaolin.utils.testing")
    testing.check_tensor = check_tensor  # type: ignore[attr-defined]
    utils.testing = testing  # type: ignore[attr-defined]
    kaolin.utils = utils  # type: ignore[attr-defined]
    sys.modules["kaolin"] = kaolin
    sys.modules["kaolin.utils"] = utils
    sys.modules["kaolin.utils.testing"] = testing


def mesh_result_to_trimesh(
    vertices: Any, faces: Any, vertex_attrs: Any = None, *, linear_to_srgb: bool = True
):
    """Convert a TRELLIS ``MeshExtractResult``'s arrays into a colored trimesh.

    ``vertex_attrs`` is ``(V, K>=3)`` with RGB in its first three columns; we map
    it to ``0..255`` vertex colors so :mod:`voxel.voxelize` can sample per-voxel
    color the same way it does for TripoSR meshes. Pure / no GPU so it's
    unit-testable without TRELLIS installed.

    TRELLIS emits colors in **linear** RGB; ``to_glb`` (which we skip) would
    gamma-encode them when baking a texture, so we do it here (``linear_to_srgb``).
    Skipping this makes everything ~2.5x too dark and collapses greens onto the
    palette's ``shadow`` slot.
    """
    import numpy as np
    import trimesh

    v = np.asarray(vertices, dtype=np.float64)
    f = np.asarray(faces, dtype=np.int64)
    kwargs: dict[str, Any] = {}
    if vertex_attrs is not None:
        a = np.asarray(vertex_attrs, dtype=np.float32)
        if a.ndim == 2 and a.shape[0] == v.shape[0] and a.shape[1] >= 3:
            rgb = np.clip(a[:, :3], 0.0, 1.0)
            if linear_to_srgb:
                rgb = np.where(
                    rgb <= 0.0031308,
                    rgb * 12.92,
                    1.055 * np.power(rgb, 1.0 / 2.4) - 0.055,
                )
            kwargs["vertex_colors"] = (np.clip(rgb, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    return trimesh.Trimesh(vertices=v, faces=f, process=False, **kwargs)


def _to_numpy(t: Any):
    """Detach a torch tensor to a numpy array, or pass through array-likes."""
    if hasattr(t, "detach"):
        return t.detach().cpu().numpy()
    return t


def _load_pipeline(device: str, half: bool):
    _ensure_trellis_on_path()
    _install_kaolin_shim()
    try:
        import torch  # noqa: F401
        from trellis.pipelines import TrellisImageTo3DPipeline
    except ImportError as exc:  # pragma: no cover - depends on external install
        raise SystemExit(f"{TRELLIS_HINT}\n(import error: {exc})")

    pipeline = TrellisImageTo3DPipeline.from_pretrained("microsoft/TRELLIS-image-large")
    if device.startswith("cuda"):
        pipeline.cuda()
    if half:
        # Experimental: halve weights to fit smaller cards. May destabilize some
        # layers (sampler/VAE); off by default. Best-effort over the model dict.
        models = getattr(pipeline, "models", None)
        if isinstance(models, dict):
            for m in models.values():
                try:
                    m.half()
                except Exception:  # noqa: BLE001 — skip layers that won't cast
                    pass
    return pipeline


def infer(
    image_path: str,
    out_path: str,
    *,
    device: str = "cuda",
    seed: int = 0,
    ss_steps: int = 12,
    ss_cfg: float = 7.5,
    slat_steps: int = 12,
    slat_cfg: float = 3.0,
    half: bool = False,
    preprocess: bool = True,
) -> Path:
    from PIL import Image

    pipeline = _load_pipeline(device, half)
    # Preserve an existing alpha cutout (the mykonos sprites are transparent-bg)
    # so TRELLIS preprocess uses it as the mask and skips rembg; else fall back
    # to RGB (rembg removes the background during preprocess).
    image = Image.open(image_path)
    image = image.convert("RGBA") if "A" in image.getbands() else image.convert("RGB")

    outputs = pipeline.run(
        image,
        seed=seed,
        # Mesh only: skip the Gaussian / radiance-field decoders (VRAM).
        formats=["mesh"],
        preprocess_image=preprocess,
        sparse_structure_sampler_params={"steps": ss_steps, "cfg_strength": ss_cfg},
        slat_sampler_params={"steps": slat_steps, "cfg_strength": slat_cfg},
    )

    meshes = outputs.get("mesh") if isinstance(outputs, dict) else None
    if not meshes:
        raise RuntimeError("TRELLIS returned no mesh output")
    mesh = meshes[0]

    tri = mesh_result_to_trimesh(
        _to_numpy(mesh.vertices),
        _to_numpy(mesh.faces),
        _to_numpy(getattr(mesh, "vertex_attrs", None)),
    )

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    tri.export(str(out))
    return out


def _main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="TRELLIS image -> mesh (CUDA).")
    ap.add_argument("image", help="input concept image")
    ap.add_argument("-o", "--out", required=True, help="output mesh path (.obj/.glb/.ply)")
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--ss-steps", type=int, default=12, help="sparse-structure sampler steps")
    ap.add_argument("--ss-cfg", type=float, default=7.5, help="sparse-structure CFG")
    ap.add_argument("--slat-steps", type=int, default=12, help="SLAT sampler steps")
    ap.add_argument("--slat-cfg", type=float, default=3.0, help="SLAT CFG")
    ap.add_argument("--half", action="store_true", help="experimental fp16 cast (less VRAM)")
    ap.add_argument("--no-preprocess", action="store_true", help="skip TRELLIS bg removal / crop")
    args = ap.parse_args(argv)

    out = infer(
        args.image,
        args.out,
        device=args.device,
        seed=args.seed,
        ss_steps=args.ss_steps,
        ss_cfg=args.ss_cfg,
        slat_steps=args.slat_steps,
        slat_cfg=args.slat_cfg,
        half=args.half,
        preprocess=not args.no_preprocess,
    )
    print(f"wrote {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
