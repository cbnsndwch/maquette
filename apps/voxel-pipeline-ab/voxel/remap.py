"""Palette remapping (Phase 5).

Re-skins an asset to a new biome palette while preserving *material semantics*.

Two cases:

- A palette-agnostic ``VoxelUnit`` (cells carry slot ``materialId``) is trivially
  re-skinned by exporting it with a different palette — the slots are the
  semantics, so :func:`voxel.export_vox.save_vox` already does this.
- A color-baked ``.vox`` is remapped by mapping each baked color back to the
  nearest *source-palette* slot (Lab ΔE), then recoloring with the *target*
  palette's color for that slot. This keeps "trunk stays a trunk, canopy stays
  canopy" across palettes.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .export_vox import decode_vox, save_vox
from .palette import Palette
from .schema import VoxelCell, VoxelUnit, empty_grid


def vox_to_unit(
    data: bytes,
    from_palette: Palette,
    *,
    unit_id: str = "remapped",
    biome: str = "unknown",
) -> VoxelUnit:
    """Reconstruct a slot-based VoxelUnit from a color-baked ``.vox``."""
    decoded = decode_vox(data)
    sx, sy, sz = decoded["size"]
    palette_rgb = decoded["palette"]

    # Map each used baked color to its nearest source-palette slot once.
    slot_cache: dict[int, str] = {}
    grid = empty_grid(max(sz, 1))
    for x, y, z, idx in decoded["voxels"]:
        if idx not in slot_cache:
            rgb = palette_rgb[idx - 1]
            slot_cache[idx] = from_palette.nearest_slot(rgb)
        if 0 <= x < 12 and 0 <= y < 12 and 0 <= z < sz:
            grid[z][y][x] = VoxelCell(slot_cache[idx])

    return VoxelUnit(id=unit_id, biome=biome, cells=grid,
                     metadata={"remappedFrom": from_palette.name})


def remap_vox_file(
    in_path: str | Path,
    out_path: str | Path,
    from_palette: Palette,
    to_palette: Palette,
) -> Path:
    data = Path(in_path).read_bytes()
    unit = vox_to_unit(data, from_palette, unit_id=Path(in_path).stem,
                       biome=to_palette.name)
    return save_vox(unit, to_palette, out_path)


def _main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Remap a .vox to a new biome palette.")
    ap.add_argument("input", help="source .vox file")
    ap.add_argument("--from", dest="from_pal", required=True, help="source palette name/path")
    ap.add_argument("--to", dest="to_pal", required=True, help="target palette name/path")
    ap.add_argument("-o", "--out", required=True)
    args = ap.parse_args(argv)

    out = remap_vox_file(
        args.input, args.out, Palette.load(args.from_pal), Palette.load(args.to_pal)
    )
    print(f"remapped {args.input} ({args.from_pal} -> {args.to_pal}) -> {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
