"""Path B step 3 — voxelize a mesh into a ``VoxelUnit``.

Pipeline:

1. Load the mesh (``.obj``/``.glb``/...) via trimesh.
2. Pick the up axis; recenter to the min corner.
3. Choose ``pitch`` so the larger horizontal extent spans the 12-voxel footprint,
   then voxelize. Height H falls out of the vertical extent (variable).
4. For each occupied voxel, find the nearest mesh surface point and sample its
   color; quantize to the nearest palette slot in CIE-Lab space.
5. Emit the centered 12x12xH grid as a ``VoxelUnit``.

The chunk-merge pass (:mod:`voxel.chunk_merge`) is applied separately.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional

import numpy as np

from .palette import Palette
from .schema import VOXEL_FOOTPRINT, VoxelCell, VoxelUnit, empty_grid

DEFAULT_FALLBACK_COLOR = (160, 160, 160)


def _load_mesh(path: str):
    import trimesh

    mesh = trimesh.load(path, force="mesh", process=False)
    if mesh.is_empty or len(mesh.faces) == 0:
        raise ValueError(f"mesh has no faces: {path}")
    return mesh


def _face_colors(mesh) -> np.ndarray:
    """(F, 3) uint8 face colors, falling back to a neutral gray."""
    try:
        fc = np.asarray(mesh.visual.face_colors)
        if fc is not None and len(fc) == len(mesh.faces):
            return fc[:, :3].astype(np.uint8)
    except Exception:  # noqa: BLE001 — visuals are optional / varied
        pass
    return np.tile(np.array(DEFAULT_FALLBACK_COLOR, dtype=np.uint8), (len(mesh.faces), 1))


def voxelize(
    mesh_path: str,
    palette: Palette,
    *,
    unit_id: str,
    biome: str,
    up_axis: int = 1,
    fill: bool = True,
    footprint: int = VOXEL_FOOTPRINT,
) -> VoxelUnit:
    mesh = _load_mesh(mesh_path)

    # Recenter so the bounding box min corner sits at the origin.
    mesh.apply_translation(-mesh.bounds[0])
    extents = mesh.extents.astype(float)

    horiz = [a for a in (0, 1, 2) if a != up_axis]
    horiz_extent = max(extents[horiz[0]], extents[horiz[1]])
    if horiz_extent <= 0:
        raise ValueError("degenerate mesh: zero horizontal extent")
    pitch = horiz_extent / footprint

    vg = mesh.voxelized(pitch=pitch)
    if fill:
        try:
            vg = vg.fill()
        except Exception:  # noqa: BLE001 — fill can fail on open meshes
            pass

    indices = np.asarray(vg.sparse_indices)  # (N, 3) matrix indices
    if len(indices) == 0:
        raise ValueError("voxelization produced no occupied cells")
    points = np.asarray(vg.points)  # (N, 3) world-space voxel centers

    # Sample nearest-surface color per occupied voxel, then quantize to palette.
    import trimesh

    _, _, tri_ids = trimesh.proximity.closest_point(mesh, points)
    rgbs = _face_colors(mesh)[tri_ids]
    slots = palette.nearest_slots(rgbs)

    # Map matrix indices into a centered footprint x footprint x H grid.
    a0, a1 = horiz
    foot_a = vg.matrix.shape[a0]
    foot_b = vg.matrix.shape[a1]
    height = int(vg.matrix.shape[up_axis])
    off_a = (footprint - foot_a) // 2
    off_b = (footprint - foot_b) // 2

    grid = empty_grid(max(height, 1))
    placed = 0
    for (idx, slot) in zip(indices, slots):
        z = int(idx[up_axis])
        gx = int(idx[a0]) + off_a
        gy = int(idx[a1]) + off_b
        if 0 <= gx < footprint and 0 <= gy < footprint and 0 <= z < height:
            grid[z][gy][gx] = VoxelCell(slot)
            placed += 1

    unit = VoxelUnit(
        id=unit_id,
        biome=biome,
        cells=grid,
        metadata={
            "source": "path-b",
            "meshPath": str(mesh_path),
            "pitch": pitch,
            "upAxis": up_axis,
            "occupiedSampled": int(len(indices)),
            "placed": placed,
        },
    )
    return unit


def _main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Path B — voxelize a mesh into a VoxelUnit.")
    ap.add_argument("mesh", help="path to a mesh (.obj/.glb/.ply)")
    ap.add_argument("--biome", default="mykonos")
    ap.add_argument("--palette", default=None, help="palette name/path (default: --biome)")
    ap.add_argument("--id", dest="unit_id", default=None)
    ap.add_argument("--up-axis", type=int, default=1, choices=(0, 1, 2),
                    help="mesh axis that maps to grid height (default 1 = Y-up)")
    ap.add_argument("--no-fill", action="store_true", help="skip solid interior fill")
    ap.add_argument("-o", "--out", required=True)
    args = ap.parse_args(argv)

    palette = Palette.load(args.palette or args.biome)
    unit_id = args.unit_id or Path(args.mesh).stem
    unit = voxelize(
        args.mesh,
        palette,
        unit_id=unit_id,
        biome=args.biome,
        up_axis=args.up_axis,
        fill=not args.no_fill,
    )
    unit.save(args.out)
    print(
        f"voxelized {args.mesh} -> {args.out} "
        f"(z={unit.dims['z']}, fill={unit.fill_percent():.1f}%, "
        f"mats={unit.unique_materials()})",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
