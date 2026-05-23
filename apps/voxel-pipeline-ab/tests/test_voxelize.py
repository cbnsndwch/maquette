from voxel.palette import Palette
from voxel.schema import VOXEL_FOOTPRINT, shape_issues
from voxel.voxelize import voxelize


def test_voxelize_box_is_solid_and_centered(colored_box):
    pal = Palette.load("mykonos")
    unit = voxelize(colored_box, pal, unit_id="box", biome="mykonos", up_axis=1, fill=True)

    assert shape_issues(unit) == []
    assert unit.dims["x"] == VOXEL_FOOTPRINT and unit.dims["y"] == VOXEL_FOOTPRINT
    # Y is the tallest axis (3.0) -> height > footprint span.
    assert unit.dims["z"] > VOXEL_FOOTPRINT
    # solid box should be (almost) fully filled
    assert unit.fill_percent() > 90.0
    # uniform blue quantizes to the 'accent' slot
    assert unit.unique_materials() == ["accent"]


def test_voxelize_unfilled_is_shell(colored_box):
    pal = Palette.load("mykonos")
    solid = voxelize(colored_box, pal, unit_id="s", biome="mykonos", fill=True)
    shell = voxelize(colored_box, pal, unit_id="h", biome="mykonos", fill=False)
    assert shell.occupied_count() < solid.occupied_count()
