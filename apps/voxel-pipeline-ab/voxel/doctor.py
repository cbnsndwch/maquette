"""Environment diagnostics for the voxel pipeline.

Run ``pnpm doctor`` to check Python, CUDA/torch, the pure-Python deps, and
whether the external GPU repos / models are present.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

from .paths import external_repos_dir

OK = "[ ok ]"
NO = "[MISS]"
WARN = "[warn]"


def _check_import(mod: str) -> tuple[bool, str]:
    try:
        m = importlib.import_module(mod)
        return True, getattr(m, "__version__", "?")
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def main(argv: list[str] | None = None) -> int:
    lines: list[str] = []
    ok_core = True

    lines.append(f"{OK} python {sys.version.split()[0]}  ({sys.executable})")

    # torch + CUDA
    have_torch, tinfo = _check_import("torch")
    if have_torch:
        import torch

        cuda = torch.cuda.is_available()
        tag = OK if cuda else WARN
        dev = torch.cuda.get_device_name(0) if cuda else "CPU only"
        vram = ""
        if cuda:
            props = torch.cuda.get_device_properties(0)
            vram = f", {props.total_memory / 1024**3:.1f} GB VRAM"
        lines.append(f"{tag} torch {torch.__version__}  (cuda={cuda}: {dev}{vram})")
    else:
        ok_core = False
        lines.append(f"{NO} torch  ({tinfo})")

    # pure-python deps
    for mod in ("numpy", "scipy", "trimesh", "PIL", "huggingface_hub", "tqdm"):
        have, info = _check_import(mod)
        if not have and mod in ("numpy", "scipy", "trimesh", "PIL"):
            ok_core = False
        lines.append(f"{OK if have else NO} {mod} {info if have else ''}".rstrip())

    # optional deps
    for mod in ("anthropic", "rembg", "tsr"):
        have, info = _check_import(mod)
        tag = OK if have else WARN
        note = "" if have else "(optional)"
        lines.append(f"{tag} {mod} {info if have else note}".rstrip())

    # external repos
    repos = external_repos_dir()
    for name in ("ComfyUI", "TripoSR"):
        present = (repos / name).exists()
        lines.append(f"{OK if present else WARN} {name} clone {'present' if present else 'missing -> pnpm ' + name.lower() + ':setup'}")

    print("\n".join(lines))
    print()
    print("core pipeline ready" if ok_core else "core deps missing -> run `pnpm setup`")
    return 0 if ok_core else 1


if __name__ == "__main__":
    raise SystemExit(main())
