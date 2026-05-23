from voxel.chunk_merge import merge
from voxel.export_vox import summarize_vox, to_vox_bytes
from voxel.palette import Palette
from voxel.schema import VoxelCell, VoxelUnit, empty_grid


def cube(material="stone", n=3, height=3):
    grid = empty_grid(height)
    for z in range(n):
        for y in range(n):
            for x in range(n):
                grid[z][y][x] = VoxelCell(material)
    return VoxelUnit(id="c", biome="mykonos", cells=grid)


def test_vox_header_and_chunks():
    pal = Palette.load("mykonos")
    data = to_vox_bytes(cube(), pal)
    assert data[:4] == b"VOX "
    info = summarize_vox(data)
    assert info["version"] == 150
    assert info["size"] == (12, 12, 3)
    assert info["num_voxels"] == 27
    assert info["palette_used"] == 1


def test_merged_cube_expands_to_same_voxel_count():
    pal = Palette.load("mykonos")
    u = cube(n=3, height=3)
    m = merge(u)
    assert summarize_vox(to_vox_bytes(u, pal))["num_voxels"] == 27
    assert summarize_vox(to_vox_bytes(m, pal))["num_voxels"] == 27


def test_multiple_materials_get_distinct_palette_slots():
    pal = Palette.load("mykonos")
    grid = empty_grid(1)
    grid[0][0][0] = VoxelCell("stone")
    grid[0][0][1] = VoxelCell("accent")
    grid[0][0][2] = VoxelCell("bark")
    u = VoxelUnit(id="m", biome="mykonos", cells=grid)
    info = summarize_vox(to_vox_bytes(u, pal))
    assert info["num_voxels"] == 3
    assert info["palette_used"] == 3
