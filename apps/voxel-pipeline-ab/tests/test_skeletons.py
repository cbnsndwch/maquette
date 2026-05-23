from voxel.palette import Palette
from voxel.schema import shape_issues
from voxel.skeletons import REGISTRY, get, match

GENERIC_SLOTS = {"primary", "accent", "stone", "bark", "foliage", "shadow", "highlight"}


def test_all_skeletons_are_well_formed():
    for name in REGISTRY:
        unit = get(name)
        assert shape_issues(unit) == [], f"{name} has shape issues"
        assert unit.occupied_count() > 0, f"{name} is empty"


def test_skeleton_materials_are_generic_slots():
    for name in REGISTRY:
        for mat in get(name).unique_materials():
            assert mat in GENERIC_SLOTS, f"{name} uses non-generic slot {mat}"


def test_skeleton_slots_exist_in_mykonos_palette():
    pal = Palette.load("mykonos")
    for name in REGISTRY:
        for mat in get(name).unique_materials():
            assert pal.has_slot(mat), f"mykonos palette missing slot {mat}"


def test_match_keywords():
    assert match("a gnarled olive tree") == "tree"
    assert match("stone archway gate") == "arch"
    assert match("a domed white chapel") == "domed-building"
    assert match("a low garden wall") == "wall-segment"
