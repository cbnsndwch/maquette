import json

from voxel.palette import Palette
from voxel.schema import VOXEL_FOOTPRINT
from voxel.validate_unit import normalize, parse_unit_text, strip_code_fences


def test_strip_code_fences_variants():
    body = '{"a": 1}'
    assert json.loads(strip_code_fences(f"```json\n{body}\n```")) == {"a": 1}
    assert json.loads(strip_code_fences(f"```\n{body}\n```")) == {"a": 1}
    assert json.loads(strip_code_fences(f"prose before {body} prose after")) == {"a": 1}


def test_parse_pads_ragged_grid_to_footprint():
    raw = {"id": "x", "biome": "mykonos", "cells": [[[{"materialId": "stone"}]]]}
    unit = parse_unit_text(json.dumps(raw))
    res = normalize(unit, Palette.load("mykonos"))
    assert res.ok
    assert res.unit.dims["x"] == VOXEL_FOOTPRINT
    assert res.unit.dims["y"] == VOXEL_FOOTPRINT
    assert len(res.unit.cells[0]) == VOXEL_FOOTPRINT
    assert all(len(row) == VOXEL_FOOTPRINT for row in res.unit.cells[0])


def test_unknown_material_dropped_by_default():
    raw = {
        "id": "x",
        "biome": "mykonos",
        "cells": [[[{"materialId": "stone"}, {"materialId": "NOPE"}]]],
    }
    res = normalize(parse_unit_text(json.dumps(raw)), Palette.load("mykonos"))
    assert res.unit.occupied_count() == 1
    assert any("NOPE" in w for w in res.warnings)


def test_unknown_material_remapped_when_requested():
    raw = {
        "id": "x",
        "biome": "mykonos",
        "cells": [[[{"materialId": "NOPE"}]]],
    }
    pal = Palette.load("mykonos")
    res = normalize(parse_unit_text(json.dumps(raw)), pal, remap_unknown=True)
    assert res.unit.occupied_count() == 1
    mat = next(res.unit.iter_cells())[3].material_id
    assert mat == pal.slot_names[0]


def test_height_budget_truncates():
    raw = {"id": "x", "biome": "mykonos", "cells": [[[None]]] * 5}
    res = normalize(parse_unit_text(json.dumps(raw)), height_budget=3)
    assert res.unit.dims["z"] == 3
    assert any("budget" in w for w in res.warnings)
