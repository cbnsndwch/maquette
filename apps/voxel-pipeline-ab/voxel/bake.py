"""Bake the committed asset cache (Phase 4.3).

Renders the Path A skeleton library to palette-matched MagicaVoxel ``.vox`` files
plus a ``manifest.json``, written into the web app's public assets so the
browser renderer can load pre-baked hero props with no runtime generation cost.

    python -m voxel.bake --biome mykonos
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .chunk_merge import merge
from .export_vox import save_vox, summarize_vox
from .palette import Palette
from .paths import repo_root
from .skeletons import REGISTRY, get
from .validate_unit import normalize

# Curated starter set committed to the web app (the full library is larger and
# regeneratable with --all).
STARTER_SET = [
    "tree",
    "cypress",
    "arch",
    "flat-building",
    "domed-building",
    "wall-segment",
    "ground-cover",
    "well",
]


def default_out_dir() -> Path:
    return repo_root() / "apps" / "web" / "public" / "assets" / "voxels"


def bake(
    biome: str, out_dir: Path, *, merge_blocks: bool = True, names: list[str] | None = None
) -> dict:
    palette = Palette.load(biome)
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, str] = {}
    details: list[dict] = []
    # Web-served path: apps/web/public is served at the site root.
    url_base = "/assets/voxels"

    for name in names or STARTER_SET:
        unit = get(name)
        unit.biome = biome
        # generic skeleton slots are guaranteed to exist in the biome palette,
        # but normalize defensively (remap anything unexpected).
        unit = normalize(unit, palette, remap_unknown=True).unit
        if merge_blocks:
            unit = merge(unit)

        vox_path = out_dir / f"{name}.vox"
        save_vox(unit, palette, vox_path)
        info = summarize_vox(vox_path.read_bytes())

        manifest[name] = f"{url_base}/{name}.vox"
        details.append(
            {
                "id": name,
                "size": list(info["size"]),
                "voxels": info["num_voxels"],
                "colors": info["palette_used"],
            }
        )

    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {"biome": biome, "assets": manifest, "details": details}, indent=2
        ),
        encoding="utf-8",
    )
    return {"out_dir": str(out_dir), "count": len(manifest), "manifest": str(manifest_path)}


def _main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Bake the committed .vox asset cache.")
    ap.add_argument("--biome", default="mykonos")
    ap.add_argument("--out", default=None, help="output dir (default: apps/web/public/assets/voxels)")
    ap.add_argument("--no-merge", action="store_true")
    ap.add_argument("--all", action="store_true", help="bake the full skeleton library, not just the starter set")
    args = ap.parse_args(argv)

    out_dir = Path(args.out) if args.out else default_out_dir()
    names = list(REGISTRY) if args.all else None
    result = bake(args.biome, out_dir, merge_blocks=not args.no_merge, names=names)
    print(
        f"baked {result['count']} assets -> {result['out_dir']}\n"
        f"manifest: {result['manifest']}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
