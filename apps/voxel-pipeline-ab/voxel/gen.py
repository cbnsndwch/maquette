"""End-to-end voxel generation CLI.

Path A (default):  description -> LLM JSON voxels (skeleton fallback offline).
Path B:            description -> concept image (ComfyUI) -> mesh (TripoSR)
                   -> voxelized grid.

Both paths then run the chunk-merge pass and write ``<id>.json`` +
``<id>.vox`` to the output dir.

Examples:
    python -m voxel.gen --desc "Olive tree, gnarled trunk" --biome mykonos
    python -m voxel.gen --desc "Domed chapel" --biome mykonos --path-b \\
        --image staging/chapel/concept.png
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional

from .palette import Palette
from .paths import out_dir as default_out_dir
from .paths import staging_dir
from .schema import VoxelUnit


def _log(msg: str) -> None:
    print(f"[gen] {msg}", file=sys.stderr)


def _slug(text: str) -> str:
    keep = "".join(c if c.isalnum() or c in " -_" else "" for c in text.lower())
    return "-".join(keep.split())[:48] or "unit"


def run_path_a(args, palette: Palette, unit_id: str) -> VoxelUnit:
    from .llm_voxels import generate

    _log(f"Path A: generating '{args.desc}' (model={args.model or 'env'})")
    result = generate(
        args.desc,
        args.biome,
        palette,
        height_budget=args.height_budget,
        max_retries=args.max_retries,
        model=args.model,
    )
    _log(f"  source={result.source} attempts={result.attempts}")
    for w in result.warnings:
        _log(f"  warning: {w}")
    result.unit.id = unit_id
    return result.unit


def run_path_b(args, palette: Palette, unit_id: str) -> VoxelUnit:
    from .voxelize import voxelize

    stage = staging_dir() / unit_id
    mesh_path = args.mesh

    if not mesh_path:
        image_path = args.image
        if not image_path:
            from .comfy import generate_concept

            _log(f"Path B: ComfyUI concept image @ {args.comfy_url}")
            image_path = str(
                generate_concept(
                    args.desc,
                    stage / "views",
                    base_url=args.comfy_url,
                    seed=args.seed,
                    ckpt_name=args.ckpt,
                    lora_name=args.lora,
                )
            )
        _log(f"  concept image: {image_path}")

        from .triposr_infer import infer

        _log("Path B: TripoSR image -> mesh")
        mesh_path = str(infer(image_path, str(stage / "mesh.obj")))
    _log(f"  mesh: {mesh_path}")

    _log("Path B: voxelizing mesh")
    unit = voxelize(
        mesh_path,
        palette,
        unit_id=unit_id,
        biome=args.biome,
        up_axis=args.up_axis,
        fill=not args.no_fill,
    )
    return unit


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Generate a VoxelUnit (.json + .vox).")
    ap.add_argument("--desc", required=True, help="object description")
    ap.add_argument("--biome", default="mykonos")
    ap.add_argument("--palette", default=None, help="palette name/path (default: --biome)")
    ap.add_argument("--id", dest="unit_id", default=None, help="unit id (default: from --desc)")
    ap.add_argument("--out-dir", default=None, help="output dir (default: app out/)")

    path = ap.add_mutually_exclusive_group()
    path.add_argument("--path-a", action="store_true", help="LLM JSON voxels (default)")
    path.add_argument("--path-b", action="store_true", help="image -> mesh -> voxels")

    ap.add_argument("--no-merge", action="store_true", help="skip the chunk-merge pass")
    ap.add_argument("--max-size", type=int, default=3, help="chunk-merge max cube size")

    # Path A
    ap.add_argument("--height-budget", type=int, default=18)
    ap.add_argument("--max-retries", type=int, default=3)
    ap.add_argument("--model", default=None, help="override VOXEL_LLM_MODEL")

    # Path B
    ap.add_argument("--image", default=None, help="use this concept image (skip ComfyUI)")
    ap.add_argument("--mesh", default=None, help="use this mesh (skip ComfyUI + TripoSR)")
    ap.add_argument("--comfy-url", default="http://127.0.0.1:8188")
    ap.add_argument("--ckpt", default=None, help="ComfyUI checkpoint name override")
    ap.add_argument("--lora", default=None, help="ComfyUI LoRA name override")
    ap.add_argument("--up-axis", type=int, default=1, choices=(0, 1, 2))
    ap.add_argument("--no-fill", action="store_true")
    ap.add_argument("--seed", type=int, default=0)
    return ap


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    palette = Palette.load(args.palette or args.biome)
    unit_id = args.unit_id or _slug(args.desc)
    out_dir = Path(args.out_dir) if args.out_dir else default_out_dir()
    out_dir.mkdir(parents=True, exist_ok=True)

    unit = run_path_b(args, palette, unit_id) if args.path_b else run_path_a(args, palette, unit_id)

    if not args.no_merge:
        from .chunk_merge import merge, merge_stats

        unit = merge(unit, max_size=args.max_size)
        _log(f"chunk-merge: {merge_stats(unit)}")

    json_path = unit.save(out_dir / f"{unit_id}.json")
    _log(f"wrote {json_path}")

    from .export_vox import save_vox, summarize_vox

    vox_path = save_vox(unit, palette, out_dir / f"{unit_id}.vox")
    _log(f"wrote {vox_path} ({summarize_vox(vox_path.read_bytes())})")

    # The unit JSON path is the single line on stdout for scripting.
    print(json_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
