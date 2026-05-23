import numpy as np
import pytest
import trimesh


@pytest.fixture
def colored_box(tmp_path):
    """A 2x3x2 box exported as .obj with uniform blue (~'accent') vertex colors."""
    box = trimesh.creation.box(extents=(2.0, 3.0, 2.0))
    box.visual.vertex_colors = np.tile(
        [42, 111, 176, 255], (len(box.vertices), 1)
    ).astype(np.uint8)
    path = tmp_path / "box.obj"
    box.export(path)
    return str(path)
