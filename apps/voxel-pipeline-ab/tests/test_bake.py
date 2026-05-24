import json

from voxel.bake import STARTER_SET, bake
from voxel.export_vox import to_vox_bytes
from voxel.palette import Palette
from voxel.schema import VoxelCell, VoxelUnit, empty_grid


def test_bake_writes_starter_set_and_manifest(tmp_path):
    bake("mykonos", tmp_path)
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["biome"] == "mykonos"
    for name in STARTER_SET:
        assert (tmp_path / f"{name}.vox").exists()
        assert manifest["assets"][name] == f"/assets/voxels/{name}.vox"


def test_bake_includes_committed_hero_vox(tmp_path):
    # a hero .vox dropped into the dir (e.g. a real Path-B output) is picked up
    pal = Palette.load("mykonos")
    grid = empty_grid(1)
    grid[0][6][6] = VoxelCell("bark")
    hero = VoxelUnit(id="hero-thing", biome="mykonos", cells=grid)
    (tmp_path / "hero-thing.vox").write_bytes(to_vox_bytes(hero, pal))

    bake("mykonos", tmp_path)
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert "hero-thing" in manifest["assets"]
    assert any(
        d["id"] == "hero-thing" and d.get("source") == "hero"
        for d in manifest["details"]
    )
