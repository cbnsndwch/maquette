"""Validate and normalize a ``VoxelUnit`` (primarily Path A / LLM output).

Tolerates the usual LLM quirks: markdown code fences, leading prose, and ragged
grids. Normalization pads every layer/row to the 12x12 footprint, drops or
remaps cells whose ``materialId`` is not in the target palette, and reports
fill/material/bbox stats.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .palette import Palette
from .schema import (
    VOXEL_FOOTPRINT,
    VoxelCell,
    VoxelUnit,
    shape_issues,
)

_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


def strip_code_fences(text: str) -> str:
    """Return the JSON payload from a possibly fenced / prose-wrapped string."""
    m = _FENCE_RE.search(text)
    if m:
        return m.group(1).strip()
    # No fence: grab the outermost {...} so leading/trailing prose is ignored.
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start : end + 1].strip()
    return text.strip()


def parse_unit_text(text: str) -> VoxelUnit:
    """Parse raw (possibly fenced) text into a :class:`VoxelUnit`."""
    payload = strip_code_fences(text)
    raw = json.loads(payload)
    return VoxelUnit.from_dict(raw)


@dataclass
class ValidationResult:
    unit: VoxelUnit
    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _pad_layer(layer: list, target: int) -> list:
    layer = list(layer[:target])
    while len(layer) < target:
        layer.append([None] * VOXEL_FOOTPRINT)
    for i, row in enumerate(layer):
        row = list(row[:VOXEL_FOOTPRINT])
        while len(row) < VOXEL_FOOTPRINT:
            row.append(None)
        layer[i] = row
    return layer


def normalize(
    unit: VoxelUnit,
    palette: Optional[Palette] = None,
    *,
    height_budget: Optional[int] = None,
    remap_unknown: bool = False,
) -> ValidationResult:
    """Pad to footprint, enforce palette membership, clamp height.

    With ``remap_unknown`` an out-of-palette ``materialId`` is remapped to the
    palette's first slot instead of being dropped.
    """
    warnings: list[str] = []
    errors: list[str] = []

    cells = [_pad_layer(layer, VOXEL_FOOTPRINT) for layer in unit.cells]

    if height_budget is not None and len(cells) > height_budget:
        warnings.append(
            f"height {len(cells)} exceeds budget {height_budget}; truncated"
        )
        cells = cells[:height_budget]

    if not cells:
        errors.append("unit has no layers after normalization")

    if palette is not None:
        fallback = palette.slot_names[0]
        unknown: dict[str, int] = {}
        for layer in cells:
            for row in layer:
                for x in range(len(row)):
                    cell = row[x]
                    if cell is None:
                        continue
                    if not palette.has_slot(cell.material_id):
                        unknown[cell.material_id] = unknown.get(cell.material_id, 0) + 1
                        if remap_unknown:
                            row[x] = VoxelCell(fallback, cell.size)
                        else:
                            row[x] = None
        for mat, count in unknown.items():
            verb = "remapped" if remap_unknown else "dropped"
            warnings.append(
                f"material '{mat}' not in palette '{palette.name}' ({count} cells {verb})"
            )

    normalized = VoxelUnit(
        id=unit.id,
        biome=unit.biome,
        cells=cells,
        pivot=unit.pivot,
        metadata=unit.metadata,
        version=unit.version,
    )
    errors.extend(shape_issues(normalized))
    return ValidationResult(
        unit=normalized, ok=not errors, errors=errors, warnings=warnings
    )


def format_stats(unit: VoxelUnit) -> str:
    bbox = unit.bounding_box()
    lines = [
        f"id           : {unit.id}",
        f"biome        : {unit.biome}",
        f"dims (x,y,z) : {unit.dims['x']}, {unit.dims['y']}, {unit.dims['z']}",
        f"occupied     : {unit.occupied_count()} cells",
        f"fill         : {unit.fill_percent():.1f}%",
        f"materials    : {', '.join(unit.unique_materials()) or '(none)'}",
        f"bounding box : {bbox if bbox else '(empty)'}",
        f"pivot        : {unit.pivot}",
    ]
    return "\n".join(lines)


def _main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Validate / normalize a VoxelUnit JSON.")
    ap.add_argument("input", help="path to a VoxelUnit JSON (or '-' for stdin)")
    ap.add_argument("--palette", help="biome name or palette JSON path to validate against")
    ap.add_argument("--height-budget", type=int, default=None)
    ap.add_argument("--remap-unknown", action="store_true")
    ap.add_argument("-o", "--out", help="write the normalized unit to this path")
    args = ap.parse_args(argv)

    text = sys.stdin.read() if args.input == "-" else Path(args.input).read_text("utf-8")
    try:
        unit = parse_unit_text(text)
    except (json.JSONDecodeError, ValueError) as exc:
        print(f"parse error: {exc}", file=sys.stderr)
        return 2

    palette = Palette.load(args.palette) if args.palette else None
    result = normalize(
        unit,
        palette,
        height_budget=args.height_budget,
        remap_unknown=args.remap_unknown,
    )

    print(format_stats(result.unit))
    for w in result.warnings:
        print(f"  warning: {w}", file=sys.stderr)
    for e in result.errors:
        print(f"  error:   {e}", file=sys.stderr)

    if args.out and result.ok:
        out = result.unit.save(args.out)
        print(f"\nwrote {out}")

    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(_main())
