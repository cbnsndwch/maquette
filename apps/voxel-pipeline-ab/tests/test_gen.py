from voxel.export_vox import summarize_vox
from voxel.gen import main as gen_main
from voxel.schema import VoxelUnit


def test_path_a_offline_fallback(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("VOXEL_LLM_MODEL", raising=False)
    monkeypatch.delenv("ANTHROPIC_MODEL", raising=False)

    rc = gen_main(
        ["--desc", "a gnarled olive tree", "--biome", "mykonos", "--out-dir", str(tmp_path)]
    )
    assert rc == 0
    json_path = tmp_path / "a-gnarled-olive-tree.json"
    vox_path = tmp_path / "a-gnarled-olive-tree.vox"
    assert json_path.exists() and vox_path.exists()

    unit = VoxelUnit.load(json_path)
    assert unit.occupied_count() > 0
    assert unit.metadata.get("chunkMerged") is True
    assert summarize_vox(vox_path.read_bytes())["num_voxels"] > 0


def test_path_b_with_provided_mesh(tmp_path, colored_box):
    rc = gen_main(
        [
            "--desc", "a blue block",
            "--biome", "mykonos",
            "--path-b",
            "--mesh", colored_box,
            "--id", "blue-block",
            "--out-dir", str(tmp_path),
        ]
    )
    assert rc == 0
    assert (tmp_path / "blue-block.json").exists()
    assert (tmp_path / "blue-block.vox").exists()
    unit = VoxelUnit.load(tmp_path / "blue-block.json")
    assert unit.unique_materials() == ["accent"]


def test_path_a_no_merge(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    rc = gen_main(
        ["--desc", "stone wall", "--out-dir", str(tmp_path), "--no-merge", "--id", "w"]
    )
    assert rc == 0
    unit = VoxelUnit.load(tmp_path / "w.json")
    assert unit.metadata.get("chunkMerged") is None
