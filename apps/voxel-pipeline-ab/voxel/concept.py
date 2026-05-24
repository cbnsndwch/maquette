"""Path B step 1 only — generate a concept image via ComfyUI (no TripoSR).

Lets you verify the ComfyUI integration and iterate on prompts / checkpoint /
LoRA before the mesh stage is set up. The full chain is `python -m voxel.gen
--path-b`.

    # SDXL base + a voxel LoRA:
    python -m voxel.concept --desc "Olive tree" --ckpt sd_xl_base_1.0.safetensors \\
        --lora voxel-isometric-xl.safetensors

    # checkpoint only (no LoRA), SDXL Turbo settings:
    python -m voxel.concept --desc "Olive tree" --ckpt sd_xl_turbo_1.0_fp16.safetensors \\
        --no-lora --steps 4 --cfg 1.0
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .comfy import generate_concept
from .paths import staging_dir


def _main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Generate a concept image via ComfyUI.")
    ap.add_argument("--desc", required=True, help="object description")
    ap.add_argument("--comfy-url", default="http://127.0.0.1:8188")
    ap.add_argument("--ckpt", default=None, help="checkpoint filename in ComfyUI")
    ap.add_argument("--lora", default=None, help="LoRA filename in ComfyUI")
    ap.add_argument("--no-lora", action="store_true", help="use the LoRA-free workflow")
    ap.add_argument("--workflow", default=None, help="workflow name (overrides --no-lora)")
    ap.add_argument("--steps", type=int, default=None, help="sampler steps (Turbo: ~4)")
    ap.add_argument("--cfg", type=float, default=None, help="CFG scale (Turbo: ~1.0)")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--id", dest="job_id", default="concept")
    ap.add_argument("-o", "--out-dir", default=None, help="image dir (default: staging/<id>/views)")
    args = ap.parse_args(argv)

    workflow = args.workflow or ("obj-concept-nolora" if args.no_lora else "obj-concept")
    out_dir = args.out_dir or str(staging_dir() / args.job_id / "views")

    try:
        image = generate_concept(
            args.desc,
            Path(out_dir),
            base_url=args.comfy_url,
            seed=args.seed,
            ckpt_name=args.ckpt,
            lora_name=None if args.no_lora else args.lora,
            workflow_name=workflow,
            steps=args.steps,
            cfg=args.cfg,
        )
    except Exception as exc:  # noqa: BLE001 — surface a friendly hint
        print(f"concept generation failed: {exc}", file=sys.stderr)
        print(
            "  - is ComfyUI running at --comfy-url?\n"
            "  - does --ckpt match a file in ComfyUI/models/checkpoints/?\n"
            "  - if you have no LoRA, pass --no-lora",
            file=sys.stderr,
        )
        return 1

    print(f"wrote {image}", file=sys.stderr)
    print(image)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
