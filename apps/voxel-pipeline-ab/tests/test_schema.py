from voxel.schema import (
    VOXEL_FOOTPRINT,
    VoxelCell,
    VoxelUnit,
    empty_grid,
    shape_issues,
)


def make_unit(height=3):
    grid = empty_grid(height)
    grid[0][6][6] = VoxelCell("bark")
    grid[1][6][6] = VoxelCell("foliage", 2)
    return VoxelUnit(id="t", biome="mykonos", cells=grid)


def test_dims_and_height():
    u = make_unit(4)
    assert u.height == 4
    assert u.dims == {"x": 12, "y": 12, "z": 4}


def test_roundtrip_preserves_everything():
    u = make_unit()
    d = u.to_dict()
    u2 = VoxelUnit.from_dict(d)
    assert u2.to_dict() == d
    assert d["cells"][0][6][6] == {"materialId": "bark", "size": 1}
    assert d["cells"][1][6][6] == {"materialId": "foliage", "size": 2}


def test_empty_grid_shape():
    g = empty_grid(5)
    assert len(g) == 5
    assert all(len(layer) == VOXEL_FOOTPRINT for layer in g)
    assert all(len(row) == VOXEL_FOOTPRINT for layer in g for row in layer)


def test_stats():
    u = make_unit()
    assert u.occupied_count() == 2
    assert set(u.unique_materials()) == {"bark", "foliage"}
    assert u.bounding_box() == ((6, 6, 0), (6, 6, 1))
    assert shape_issues(u) == []


def test_shape_issues_detects_ragged():
    u = make_unit()
    u.cells[0].pop()  # drop a row
    assert any("rows" in m for m in shape_issues(u))


def test_snake_case_input_tolerated():
    u = VoxelUnit.from_dict(
        {"id": "x", "biome": "b", "cells": [[[{"material_id": "stone"}]]]}
    )
    x, y, z, cell = next(u.iter_cells())
    assert cell.material_id == "stone"
