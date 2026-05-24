"""Tests for the pure (no-GPU) parts of voxel.trellis_infer.

The TRELLIS package isn't importable in CI / without a GPU, but the helper that
turns a MeshExtractResult's arrays into a colored trimesh is plain numpy/trimesh
and is the bit most likely to silently break the color pipeline, so we cover it.
"""

import numpy as np
import trimesh

from voxel.trellis_infer import mesh_result_to_trimesh

# A unit tetrahedron: 4 verts, 4 faces.
_VERTS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]
_FACES = [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]


def test_builds_mesh_without_attrs():
    m = mesh_result_to_trimesh(_VERTS, _FACES, None)
    assert isinstance(m, trimesh.Trimesh)
    assert len(m.vertices) == 4 and len(m.faces) == 4


def test_vertex_attrs_raw_become_0_255_vertex_colors():
    # linear_to_srgb=False keeps the direct 0..1 -> 0..255 mapping.
    attrs = np.array(
        [
            [1.0, 0.0, 0.0, 0.9],
            [0.0, 1.0, 0.0, 0.1],
            [0.0, 0.0, 1.0, 0.5],
            [0.5, 0.5, 0.5, 0.0],
        ],
        dtype=np.float32,
    )
    m = mesh_result_to_trimesh(_VERTS, _FACES, attrs, linear_to_srgb=False)
    vc = np.asarray(m.visual.vertex_colors)[:, :3]
    assert vc[0].tolist() == [255, 0, 0]
    assert vc[1].tolist() == [0, 255, 0]
    assert vc[2].tolist() == [0, 0, 255]
    # 0.5 -> 128 (round-half-up via +0.5 before truncation)
    assert vc[3].tolist() == [128, 128, 128]


def test_linear_to_srgb_brightens_midtones():
    # Default path gamma-encodes linear RGB; pure 0/1 are fixed points, 0.5 lifts.
    attrs = np.array([[0.5, 0.5, 0.5], [0.0, 0.0, 0.0], [1.0, 1.0, 1.0], [0.5, 0.5, 0.5]], dtype=np.float32)
    m = mesh_result_to_trimesh(_VERTS, _FACES, attrs)
    vc = np.asarray(m.visual.vertex_colors)[:, :3]
    assert vc[1].tolist() == [0, 0, 0]
    assert vc[2].tolist() == [255, 255, 255]
    # linear 0.5 -> sRGB ~0.735 -> ~188 (much brighter than the raw 128)
    assert vc[0][0] in range(185, 192)


def test_out_of_range_attrs_are_clipped():
    attrs = np.array(
        [[-1.0, 2.0, 0.5], [0.0, 0.0, 0.0], [1.0, 1.0, 1.0], [0.5, 0.5, 0.5]],
        dtype=np.float32,
    )
    m = mesh_result_to_trimesh(_VERTS, _FACES, attrs, linear_to_srgb=False)
    vc = np.asarray(m.visual.vertex_colors)[:, :3]
    assert vc[0].tolist() == [0, 255, 128]


def test_mismatched_attrs_are_ignored():
    # Wrong row count -> no colors applied, but mesh still builds.
    attrs = np.zeros((2, 3), dtype=np.float32)
    m = mesh_result_to_trimesh(_VERTS, _FACES, attrs)
    assert isinstance(m, trimesh.Trimesh)
    assert len(m.vertices) == 4
