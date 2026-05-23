"""Palette-agnostic structural skeletons (Path A library).

Each skeleton is a parametric generator that records *shape* + *semantic
material slots* (``primary``, ``accent``, ``stone``, ``bark``, ``foliage``,
``shadow``, ``highlight``) on the 12x12xH grid. They carry no concrete colors;
the biome system applies its palette to the slots at render time.

Run ``python -m voxel.skeletons --all`` to (re)write the committed JSON library
under ``skeletons/``.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path
from typing import Callable

from .schema import VOXEL_FOOTPRINT, VoxelCell, VoxelUnit, empty_grid

SKELETONS_DIR = Path(__file__).resolve().parent.parent / "skeletons"
C = VOXEL_FOOTPRINT / 2.0  # footprint center (6.0)

Builder = Callable[[], VoxelUnit]


def _set(grid, x: int, y: int, z: int, material: str, size: int = 1) -> None:
    if 0 <= z < len(grid) and 0 <= y < VOXEL_FOOTPRINT and 0 <= x < VOXEL_FOOTPRINT:
        grid[z][y][x] = VoxelCell(material, size)


def _disc(grid, z: int, cx: float, cy: float, r: float, material: str) -> None:
    """Filled disc of voxels at layer z."""
    for y in range(VOXEL_FOOTPRINT):
        for x in range(VOXEL_FOOTPRINT):
            if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                _set(grid, x, y, z, material)


def _box_walls(grid, z: int, x0: int, y0: int, x1: int, y1: int, material: str) -> None:
    """Hollow rectangular wall ring at layer z (inclusive corners)."""
    for x in range(x0, x1 + 1):
        _set(grid, x, y0, z, material)
        _set(grid, x, y1, z, material)
    for y in range(y0, y1 + 1):
        _set(grid, x0, y, z, material)
        _set(grid, x1, y, z, material)


# --- generators --------------------------------------------------------------


def tree() -> VoxelUnit:
    h = 16
    grid = empty_grid(h)
    trunk_top = 6
    for z in range(trunk_top):
        for dx in (5, 6):
            for dy in (5, 6):
                _set(grid, dx, dy, z, "bark")
    # canopy: stacked ellipsoid of foliage above the trunk
    cz = 11
    rz = 5
    for z in range(trunk_top - 1, h):
        t = (z - cz) / rz
        if abs(t) > 1.0:
            continue
        r = 4.6 * math.sqrt(max(0.0, 1.0 - t * t))
        _disc(grid, z, C, C, r, "foliage")
    return VoxelUnit(id="tree", biome="generic", cells=grid,
                     metadata={"skeleton": "tree", "slots": ["bark", "foliage"]})


def cypress() -> VoxelUnit:
    h = 18
    grid = empty_grid(h)
    for z in range(3):
        for dx in (5, 6):
            for dy in (5, 6):
                _set(grid, dx, dy, z, "bark")
    for z in range(2, h):
        # narrow flame taper
        r = max(0.8, 3.2 * (1.0 - (z / h)) + 0.6)
        _disc(grid, z, C, C, r, "foliage")
    return VoxelUnit(id="cypress", biome="generic", cells=grid,
                     metadata={"skeleton": "cypress", "slots": ["bark", "foliage"]})


def arch() -> VoxelUnit:
    h = 11
    grid = empty_grid(h)
    pillar_h = 8
    left, right = 3, 8
    for z in range(pillar_h):
        for y in (5, 6):
            _set(grid, left, y, z, "stone")
            _set(grid, right, y, z, "stone")
    # lintel + keystone arc across the top
    for z in range(pillar_h, h):
        span = right - left
        for x in range(left, right + 1):
            curve = math.sin(math.pi * (x - left) / span)
            if z - pillar_h <= 1 or curve > 0.4:
                for y in (5, 6):
                    _set(grid, x, y, z, "stone")
    return VoxelUnit(id="arch", biome="generic", cells=grid,
                     metadata={"skeleton": "arch", "slots": ["stone"]})


def flat_building() -> VoxelUnit:
    h = 8
    grid = empty_grid(h)
    x0, y0, x1, y1 = 2, 2, 9, 9
    for z in range(h - 1):
        mat = "shadow" if z == 0 else "primary"
        _box_walls(grid, z, x0, y0, x1, y1, mat)
    # flat roof slab with an accent parapet edge
    top = h - 1
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            _set(grid, x, y, top, "primary")
    _box_walls(grid, top, x0, y0, x1, y1, "accent")
    return VoxelUnit(id="flat-building", biome="generic", cells=grid,
                     metadata={"skeleton": "flat-building",
                               "slots": ["primary", "accent", "shadow"]})


def domed_building() -> VoxelUnit:
    h = 11
    grid = empty_grid(h)
    x0, y0, x1, y1 = 2, 2, 9, 9
    body_h = 6
    for z in range(body_h):
        mat = "shadow" if z == 0 else "primary"
        _box_walls(grid, z, x0, y0, x1, y1, mat)
    # dome cap (accent) — hemisphere of discs
    dome_r = 4.0
    for z in range(body_h, h):
        t = (z - body_h) / dome_r
        if t > 1.0:
            break
        r = dome_r * math.sqrt(max(0.0, 1.0 - t * t))
        _disc(grid, z, C, C, r, "accent")
    return VoxelUnit(id="domed-building", biome="generic", cells=grid,
                     metadata={"skeleton": "domed-building",
                               "slots": ["primary", "accent", "shadow"]})


def wall_segment() -> VoxelUnit:
    h = 5
    grid = empty_grid(h)
    y = 6
    for z in range(h - 1):
        for x in range(1, VOXEL_FOOTPRINT - 1):
            _set(grid, x, y, z, "stone")
            _set(grid, x, y - 1, z, "stone")
    # capstones (highlight) every other column on top
    for x in range(1, VOXEL_FOOTPRINT - 1, 2):
        _set(grid, x, y, h - 1, "highlight")
        _set(grid, x, y - 1, h - 1, "highlight")
    return VoxelUnit(id="wall-segment", biome="generic", cells=grid,
                     metadata={"skeleton": "wall-segment",
                               "slots": ["stone", "highlight"]})


def ground_cover() -> VoxelUnit:
    h = 3
    grid = empty_grid(h)
    # deterministic scatter of low foliage clumps + a few accent "flowers"
    clumps = [(3, 3), (4, 8), (8, 4), (9, 9), (6, 6), (2, 7), (10, 6)]
    for i, (cx, cy) in enumerate(clumps):
        _set(grid, cx, cy, 0, "foliage")
        _set(grid, cx, cy, 1, "foliage")
        for dx, dy in ((1, 0), (0, 1)):
            _set(grid, cx + dx, cy + dy, 0, "foliage")
        if i % 3 == 0:
            _set(grid, cx, cy, 2, "accent")
    return VoxelUnit(id="ground-cover", biome="generic", cells=grid,
                     metadata={"skeleton": "ground-cover",
                               "slots": ["foliage", "accent"]})


def well() -> VoxelUnit:
    h = 4
    grid = empty_grid(h)
    for z in range(h - 1):
        _box_walls(grid, z, 4, 4, 7, 7, "stone")
    # dark water at the bottom interior
    for y in (5, 6):
        for x in (5, 6):
            _set(grid, x, y, 0, "shadow")
    return VoxelUnit(id="well", biome="generic", cells=grid,
                     metadata={"skeleton": "well", "slots": ["stone", "shadow"]})


# --- parametric families -----------------------------------------------------


def _tree(height: int, trunk_top: int, cz: float, rz: float, rx: float):
    grid = empty_grid(height)
    for z in range(trunk_top):
        for dx in (5, 6):
            for dy in (5, 6):
                _set(grid, dx, dy, z, "bark")
    for z in range(trunk_top - 1, height):
        t = (z - cz) / rz
        if abs(t) > 1.0:
            continue
        r = rx * math.sqrt(max(0.0, 1.0 - t * t))
        _disc(grid, z, C, C, r, "foliage")
    return grid


def _building(height: int, inset: int, domed: bool, dome_r: float, band: int = 4):
    grid = empty_grid(height)
    x0, y0, x1, y1 = inset, inset, 11 - inset, 11 - inset
    body_h = height - (int(dome_r) if domed else 1)
    for z in range(max(body_h, 1)):
        mat = "shadow" if z == 0 else "primary"
        _box_walls(grid, z, x0, y0, x1, y1, mat)
        if z > 0 and z % band == 0:
            _box_walls(grid, z, x0, y0, x1, y1, "accent")
    if domed:
        for z in range(body_h, height):
            t = (z - body_h) / dome_r
            if t > 1.0:
                break
            r = dome_r * math.sqrt(max(0.0, 1.0 - t * t))
            _disc(grid, z, C, C, r, "accent")
    else:
        top = height - 1
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                _set(grid, x, y, top, "primary")
        _box_walls(grid, top, x0, y0, x1, y1, "accent")
    return grid


def _column(height: int, *, taper: bool = False):
    grid = empty_grid(height)
    for z in range(height):
        r = max(0, 2 - (z * 2) // height) if taper else 1
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                _set(grid, 6 + dx, 6 + dy, z, "stone")
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            _set(grid, 6 + dx, 6 + dy, 0, "stone")
    _set(grid, 6, 6, height - 1, "highlight")
    return grid


def _wall(height: int, *, gate: bool = False):
    grid = empty_grid(height)
    y = 6
    for z in range(height - 1):
        for x in range(1, 11):
            if gate and 4 <= x <= 7 and z < height - 2:
                continue  # gate opening
            _set(grid, x, y, z, "stone")
            _set(grid, x, y - 1, z, "stone")
    for x in range(1, 11, 2):
        _set(grid, x, y, height - 1, "highlight")
        _set(grid, x, y - 1, height - 1, "highlight")
    return grid


def _fountain():
    grid = empty_grid(5)
    for z in range(2):
        _box_walls(grid, z, 3, 3, 8, 8, "stone")
    for y in range(4, 8):
        for x in range(4, 8):
            _set(grid, x, y, 0, "shadow")  # water
    for z in range(2, 5):
        _set(grid, 6, 6, z, "stone")  # central spout
    _set(grid, 6, 6, 4, "accent")
    return grid


def _steps(height: int):
    grid = empty_grid(height)
    for s in range(height):
        for x in range(1, 11):
            for y in range(s, 11):
                _set(grid, x, y, s, "stone" if s % 2 else "highlight")
    return grid


def _make(grid, name: str, slots: list[str]) -> VoxelUnit:
    return VoxelUnit(id=name, biome="generic", cells=grid,
                     metadata={"skeleton": name, "slots": slots})


REGISTRY: dict[str, Builder] = {
    "tree": tree,
    "cypress": cypress,
    "arch": arch,
    "flat-building": flat_building,
    "domed-building": domed_building,
    "wall-segment": wall_segment,
    "ground-cover": ground_cover,
    "well": well,
    # parametric variants (Phase 5 library expansion)
    "tree-small": lambda: _make(_tree(11, 4, 8, 4, 3.4), "tree-small", ["bark", "foliage"]),
    "tree-large": lambda: _make(_tree(20, 7, 14, 6, 5.4), "tree-large", ["bark", "foliage"]),
    "tree-wide": lambda: _make(_tree(14, 5, 10, 4, 5.6), "tree-wide", ["bark", "foliage"]),
    "cypress-short": lambda: _make(_tree(12, 3, 7, 5, 2.2), "cypress-short", ["bark", "foliage"]),
    "building-1story": lambda: _make(_building(6, 2, False, 0), "building-1story", ["primary", "accent", "shadow"]),
    "building-2story": lambda: _make(_building(11, 2, False, 0), "building-2story", ["primary", "accent", "shadow"]),
    "building-3story": lambda: _make(_building(16, 2, False, 0), "building-3story", ["primary", "accent", "shadow"]),
    "building-small": lambda: _make(_building(7, 3, False, 0), "building-small", ["primary", "accent", "shadow"]),
    "dome-small": lambda: _make(_building(9, 3, True, 3.0), "dome-small", ["primary", "accent", "shadow"]),
    "dome-large": lambda: _make(_building(13, 2, True, 5.0), "dome-large", ["primary", "accent", "shadow"]),
    "tower": lambda: _make(_building(20, 4, False, 0), "tower", ["primary", "accent", "shadow"]),
    "column": lambda: _make(_column(10), "column", ["stone", "highlight"]),
    "obelisk": lambda: _make(_column(14, taper=True), "obelisk", ["stone", "highlight"]),
    "wall-high": lambda: _make(_wall(8), "wall-high", ["stone", "highlight"]),
    "wall-gate": lambda: _make(_wall(8, gate=True), "wall-gate", ["stone", "highlight"]),
    "fountain": lambda: _make(_fountain(), "fountain", ["stone", "shadow", "accent"]),
    "steps": lambda: _make(_steps(5), "steps", ["stone", "highlight"]),
}

# Keyword hints used by Path A's fallback to pick a skeleton from a description.
KEYWORDS: dict[str, tuple[str, ...]] = {
    "tree": ("tree", "olive", "oak", "canopy", "leaf"),
    "cypress": ("cypress", "pine", "tall tree", "column tree"),
    "arch": ("arch", "gate", "doorway", "entrance", "portal"),
    "flat-building": ("building", "house", "flat", "cube house", "box"),
    "domed-building": ("dome", "domed", "chapel", "church", "rotunda"),
    "wall-segment": ("wall", "fence", "barrier"),
    "ground-cover": ("flower", "bush", "shrub", "ground", "grass", "cluster"),
    "well": ("well", "cistern"),
    # parametric variants — specific terms only, so base entries win generic words
    "tree-small": ("small tree", "sapling", "shrub tree"),
    "tree-large": ("large tree", "big tree", "ancient tree"),
    "tree-wide": ("wide tree", "spreading tree"),
    "cypress-short": ("short cypress", "young pine"),
    "building-1story": ("single story", "one story", "hut"),
    "building-2story": ("two story", "two-story"),
    "building-3story": ("three story", "tall building", "apartment"),
    "building-small": ("small house", "cottage"),
    "dome-small": ("small dome", "shrine"),
    "dome-large": ("great dome", "basilica", "rotunda"),
    "tower": ("tower",),
    "column": ("column", "pillar"),
    "obelisk": ("obelisk", "monument", "spire"),
    "wall-high": ("high wall", "tall wall", "rampart"),
    "wall-gate": ("gate wall", "gateway wall"),
    "fountain": ("fountain",),
    "steps": ("steps", "staircase", "stairway"),
}


def get(name: str) -> VoxelUnit:
    if name not in REGISTRY:
        raise KeyError(f"unknown skeleton {name!r}; have {sorted(REGISTRY)}")
    return REGISTRY[name]()


def match(description: str) -> str:
    """Pick the best skeleton name for a free-text description (Path A fallback)."""
    text = description.lower()
    best, best_score = "flat-building", 0
    for name, words in KEYWORDS.items():
        score = sum(1 for w in words if w in text)
        if score > best_score:
            best, best_score = name, score
    return best


def write_all(out_dir: Path = SKELETONS_DIR) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for name, build in REGISTRY.items():
        unit = build()
        written.append(unit.save(out_dir / f"{name}.json"))
    return written


def _main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Generate the Path A skeleton library.")
    ap.add_argument("--all", action="store_true", help="write every skeleton")
    ap.add_argument("--name", help="write a single skeleton by name")
    ap.add_argument("--out", default=str(SKELETONS_DIR))
    args = ap.parse_args(argv)

    out_dir = Path(args.out)
    if args.name:
        path = get(args.name).save(out_dir / f"{args.name}.json")
        print(f"wrote {path}")
    else:
        for path in write_all(out_dir):
            print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
