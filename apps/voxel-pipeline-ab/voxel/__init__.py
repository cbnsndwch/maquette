"""Local CUDA voxel pipeline (Plan A+B) for the Musicologia biome system.

Two generation paths feed the same ``VoxelUnit`` schema (see :mod:`voxel.schema`):

* **Path A** — an LLM emits the voxel grid directly as JSON (:mod:`voxel.llm_voxels`).
* **Path B** — concept image -> mesh (TripoSR) -> voxelized grid
  (:mod:`voxel.triposr_infer`, :mod:`voxel.voxelize`, :mod:`voxel.chunk_merge`).

Both export to MagicaVoxel ``.vox`` via :mod:`voxel.export_vox`.
"""

from .schema import (
    VOXEL_FOOTPRINT,
    VOXEL_UNIT_VERSION,
    VoxelCell,
    VoxelUnit,
)

__all__ = [
    "VOXEL_FOOTPRINT",
    "VOXEL_UNIT_VERSION",
    "VoxelCell",
    "VoxelUnit",
]
