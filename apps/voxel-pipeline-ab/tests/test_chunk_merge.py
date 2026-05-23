from voxel.chunk_merge import merge, merge_stats
from voxel.schema import VoxelCell, VoxelUnit, empty_grid


def solid(material="stone", n=3, height=3):
    grid = empty_grid(height)
    for z in range(n):
        for y in range(n):
            for x in range(n):
                grid[z][y][x] = VoxelCell(material)
    return VoxelUnit(id="solid", biome="b", cells=grid)


def test_uniform_cube_collapses_to_single_size3():
    u = solid(n=3, height=3)
    assert u.occupied_count() == 27
    m = merge(u)
    assert m.occupied_count() == 1  # one origin
    cell = next(m.iter_cells())[3]
    assert cell.size == 3
    assert merge_stats(m) == {1: 0, 2: 0, 3: 1}


def test_merge_respects_max_size():
    u = solid(n=3, height=3)
    m = merge(u, max_size=2)
    stats = merge_stats(m)
    assert stats[3] == 0
    assert stats[2] >= 1


def test_material_boundary_blocks_merge():
    grid = empty_grid(2)
    for y in range(2):
        for x in range(2):
            grid[0][y][x] = VoxelCell("stone")
    grid[0][0][0] = VoxelCell("accent")  # break uniformity
    u = VoxelUnit(id="b", biome="b", cells=grid)
    m = merge(u)
    # the lone accent cell cannot merge; nothing forms a full 2x2x2 cube anyway
    assert all(c.size == 1 for _, _, _, c in m.iter_cells())


def test_merge_preserves_total_volume():
    u = solid(material="foliage", n=3, height=3)

    def volume(unit):
        return sum(c.size**3 for _, _, _, c in unit.iter_cells())

    assert volume(merge(u)) == u.occupied_count()
