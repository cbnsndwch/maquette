from voxel.export_vox import decode_vox, to_vox_bytes
from voxel.palette import Palette
from voxel.remap import remap_vox_file, vox_to_unit
from voxel.schema import VoxelCell, VoxelUnit, empty_grid


def _baked(material, palette):
    grid = empty_grid(1)
    grid[0][6][6] = VoxelCell(material)
    unit = VoxelUnit(id="t", biome=palette.name, cells=grid)
    return to_vox_bytes(unit, palette)


def test_vox_to_unit_recovers_slot_via_nearest_color():
    mykonos = Palette.load("mykonos")
    data = _baked("bark", mykonos)
    unit = vox_to_unit(data, mykonos)
    # the single voxel's baked color maps back to the 'bark' slot
    mats = unit.unique_materials()
    assert mats == ["bark"]


def test_remap_preserves_material_semantics(tmp_path):
    mykonos = Palette.load("mykonos")
    cyber = Palette.load("cyberpunk")
    src = tmp_path / "src.vox"
    src.write_bytes(_baked("foliage", mykonos))

    out = remap_vox_file(src, tmp_path / "out.vox", mykonos, cyber)
    decoded = decode_vox(out.read_bytes())
    used = {i for *_, i in decoded["voxels"]}
    colors = {tuple(decoded["palette"][i - 1]) for i in used}
    # foliage stays foliage: recolored to cyberpunk's foliage slot, not mykonos'.
    from voxel.palette import hex_to_rgb

    assert colors == {hex_to_rgb(cyber.slots["foliage"])}
    assert colors != {hex_to_rgb(mykonos.slots["foliage"])}


def test_remap_roundtrip_same_palette_is_identity(tmp_path):
    mykonos = Palette.load("mykonos")
    src = tmp_path / "src.vox"
    src.write_bytes(_baked("stone", mykonos))
    out = remap_vox_file(src, tmp_path / "out.vox", mykonos, mykonos)
    a, b = decode_vox(src.read_bytes()), decode_vox(out.read_bytes())
    assert a["voxels"] == b["voxels"]
