"""Greedy 3D chunk-merge — the variable-block-size pass.

For each unvisited occupied cell, expand the largest cube (up to ``max_size``,
capped at 3 by the schema) whose cells are all occupied, share the same
``materialId``, and are unvisited. The cube's min-corner cell records ``size``;
the other cells it covers are set to ``None`` so the renderer draws one cube per
origin. This yields large blocks in dense, uniform zones and 1x1 detail at
material boundaries — the "Rodin tree" look.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .schema import VALID_SIZES, VoxelCell, VoxelUnit, empty_grid


def _cube_uniform(unit: VoxelUnit, visited, x: int, y: int, z: int, s: int, material: str) -> bool:
    """True if the s^3 cube at min-corner (x,y,z) is in-bounds, all the same
    material, occupied, and unvisited."""
    h = unit.height
    if z + s > h or y + s > 12 or x + s > 12:
        return False
    for dz in range(s):
        layer = unit.cells[z + dz]
        vlayer = visited[z + dz]
        for dy in range(s):
            row = layer[y + dy]
            vrow = vlayer[y + dy]
            for dx in range(s):
                cell = row[x + dx]
                if cell is None or cell.material_id != material or vrow[x + dx]:
                    return False
    return True


def _mark(visited, x: int, y: int, z: int, s: int) -> None:
    for dz in range(s):
        for dy in range(s):
            for dx in range(s):
                visited[z + dz][y + dy][x + dx] = True


def merge(unit: VoxelUnit, *, max_size: int = 3) -> VoxelUnit:
    """Return a new unit with cubes collapsed into ``size`` 2/3 cells."""
    max_size = min(max_size, max(VALID_SIZES))
    h = unit.height
    visited = [[[False] * 12 for _ in range(12)] for _ in range(h)]
    out = empty_grid(h)

    for z in range(h):
        for y in range(12):
            for x in range(12):
                cell = unit.cells[z][y][x]
                if cell is None or visited[z][y][x]:
                    continue
                chosen = 1
                for s in range(max_size, 1, -1):
                    if _cube_uniform(unit, visited, x, y, z, s, cell.material_id):
                        chosen = s
                        break
                _mark(visited, x, y, z, chosen)
                out[z][y][x] = VoxelCell(cell.material_id, chosen)

    merged = VoxelUnit(
        id=unit.id,
        biome=unit.biome,
        cells=out,
        pivot=unit.pivot,
        metadata={**unit.metadata, "chunkMerged": True},
        version=unit.version,
    )
    return merged


def merge_stats(unit: VoxelUnit) -> dict[str, int]:
    counts = {s: 0 for s in VALID_SIZES}
    for _, _, _, cell in unit.iter_cells():
        counts[cell.size] = counts.get(cell.size, 0) + 1
    return counts


def _main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run the greedy chunk-merge pass.")
    ap.add_argument("input", help="VoxelUnit JSON to merge")
    ap.add_argument("-o", "--out", help="output path (default: alongside input)")
    ap.add_argument("--max-size", type=int, default=3)
    args = ap.parse_args(argv)

    unit = VoxelUnit.load(args.input)
    before = unit.occupied_count()
    merged = merge(unit, max_size=args.max_size)
    after = merged.occupied_count()
    stats = merge_stats(merged)
    print(
        f"merged {before} cells -> {after} blocks "
        f"(1x1: {stats.get(1,0)}, 2x2: {stats.get(2,0)}, 3x3: {stats.get(3,0)})",
        file=sys.stderr,
    )
    out = args.out or str(Path(args.input).with_suffix("")) + ".merged.json"
    merged.save(out)
    print(f"wrote {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
