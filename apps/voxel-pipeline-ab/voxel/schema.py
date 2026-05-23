"""Python mirror of the ``VoxelUnit`` contract.

Kept byte-for-byte compatible with the canonical TypeScript schema in
``libs/contracts/src/voxel-unit.mts`` so JSON produced here is consumed
unchanged by the biome renderer. Cells reference biome palette *slots* by name
(``material_id``) rather than concrete colors.

Grid indexing is ``cells[z][y][x]``; ``None`` marks an empty cell.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator, Optional

#: Footprint side length, in voxels. Both x and y are fixed at this value.
VOXEL_FOOTPRINT = 12

#: Bump when the schema changes in a backwards-incompatible way.
VOXEL_UNIT_VERSION = 1

#: Allowed chunk-merge cube sizes.
VALID_SIZES = (1, 2, 3)

Grid = list[list[list[Optional["VoxelCell"]]]]


@dataclass
class VoxelCell:
    """A single occupied voxel (or a merged cube when ``size`` > 1)."""

    material_id: str
    size: int = 1

    def to_dict(self) -> dict[str, Any]:
        return {"materialId": self.material_id, "size": self.size}

    @staticmethod
    def from_dict(raw: dict[str, Any]) -> "VoxelCell":
        # Tolerate both camelCase (canonical) and snake_case input.
        material_id = raw.get("materialId", raw.get("material_id"))
        if not isinstance(material_id, str) or not material_id:
            raise ValueError(f"cell missing a string materialId: {raw!r}")
        size = int(raw.get("size", 1) or 1)
        return VoxelCell(material_id=material_id, size=size)


@dataclass
class VoxelUnit:
    """A palette-agnostic voxel prop on a fixed 12x12 footprint, variable height."""

    id: str
    biome: str
    cells: Grid
    pivot: tuple[float, float] = (VOXEL_FOOTPRINT / 2, VOXEL_FOOTPRINT / 2)
    metadata: dict[str, Any] = field(default_factory=dict)
    version: int = VOXEL_UNIT_VERSION

    # -- derived dims ----------------------------------------------------

    @property
    def height(self) -> int:
        return len(self.cells)

    @property
    def dims(self) -> dict[str, int]:
        return {"x": VOXEL_FOOTPRINT, "y": VOXEL_FOOTPRINT, "z": self.height}

    # -- (de)serialization ----------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        cells = [
            [[c.to_dict() if c is not None else None for c in row] for row in layer]
            for layer in self.cells
        ]
        out: dict[str, Any] = {
            "version": self.version,
            "id": self.id,
            "biome": self.biome,
            "dims": self.dims,
            "cells": cells,
            "pivot": {"x": self.pivot[0], "y": self.pivot[1]},
        }
        if self.metadata:
            out["metadata"] = self.metadata
        return out

    def to_json(self, *, indent: int | None = None) -> str:
        return json.dumps(self.to_dict(), indent=indent)

    def save(self, path: str | Path, *, indent: int | None = 2) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.to_json(indent=indent), encoding="utf-8")
        return path

    @staticmethod
    def from_dict(raw: dict[str, Any]) -> "VoxelUnit":
        if "cells" not in raw:
            raise ValueError("VoxelUnit JSON missing 'cells'")
        cells: Grid = []
        for layer in raw["cells"]:
            out_layer: list[list[Optional[VoxelCell]]] = []
            for row in layer:
                out_row: list[Optional[VoxelCell]] = []
                for cell in row:
                    if cell is None:
                        out_row.append(None)
                    elif isinstance(cell, dict):
                        out_row.append(VoxelCell.from_dict(cell))
                    else:
                        raise ValueError(f"unexpected cell value: {cell!r}")
                out_layer.append(out_row)
            cells.append(out_layer)

        pivot_raw = raw.get("pivot") or {}
        pivot = (
            float(pivot_raw.get("x", VOXEL_FOOTPRINT / 2)),
            float(pivot_raw.get("y", VOXEL_FOOTPRINT / 2)),
        )
        return VoxelUnit(
            id=str(raw.get("id", "unnamed")),
            biome=str(raw.get("biome", "unknown")),
            cells=cells,
            pivot=pivot,
            metadata=dict(raw.get("metadata") or {}),
            version=int(raw.get("version", VOXEL_UNIT_VERSION)),
        )

    @staticmethod
    def load(path: str | Path) -> "VoxelUnit":
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        return VoxelUnit.from_dict(raw)

    # -- analysis --------------------------------------------------------

    def iter_cells(self) -> Iterator[tuple[int, int, int, VoxelCell]]:
        """Yield ``(x, y, z, cell)`` for every occupied cell."""
        for z, layer in enumerate(self.cells):
            for y, row in enumerate(layer):
                for x, cell in enumerate(row):
                    if cell is not None:
                        yield x, y, z, cell

    def occupied_count(self) -> int:
        return sum(1 for _ in self.iter_cells())

    def fill_percent(self) -> float:
        total = VOXEL_FOOTPRINT * VOXEL_FOOTPRINT * max(self.height, 1)
        return 100.0 * self.occupied_count() / total

    def unique_materials(self) -> list[str]:
        seen: dict[str, None] = {}
        for _, _, _, cell in self.iter_cells():
            seen.setdefault(cell.material_id, None)
        return list(seen)

    def bounding_box(self) -> Optional[tuple[tuple[int, int, int], tuple[int, int, int]]]:
        """Inclusive ``((min_x, min_y, min_z), (max_x, max_y, max_z))`` or None if empty."""
        xs: list[int] = []
        ys: list[int] = []
        zs: list[int] = []
        for x, y, z, _ in self.iter_cells():
            xs.append(x)
            ys.append(y)
            zs.append(z)
        if not xs:
            return None
        return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def empty_grid(height: int) -> Grid:
    """An all-empty (``None``) ``height``×12×12 grid."""
    if height <= 0:
        raise ValueError("height must be positive")
    return [
        [[None for _ in range(VOXEL_FOOTPRINT)] for _ in range(VOXEL_FOOTPRINT)]
        for _ in range(height)
    ]


def shape_issues(unit: VoxelUnit) -> list[str]:
    """Return human-readable shape problems; empty list when consistent."""
    issues: list[str] = []
    z = unit.height
    if z <= 0:
        issues.append("unit has no z-layers")
    for zi, layer in enumerate(unit.cells):
        if len(layer) != VOXEL_FOOTPRINT:
            issues.append(
                f"layer {zi}: expected {VOXEL_FOOTPRINT} rows, got {len(layer)}"
            )
        for yi, row in enumerate(layer):
            if len(row) != VOXEL_FOOTPRINT:
                issues.append(
                    f"layer {zi} row {yi}: expected {VOXEL_FOOTPRINT} cols, got {len(row)}"
                )
    for _, _, _, cell in unit.iter_cells():
        if cell.size not in VALID_SIZES:
            issues.append(f"cell size {cell.size} not in {VALID_SIZES}")
            break
    return issues
