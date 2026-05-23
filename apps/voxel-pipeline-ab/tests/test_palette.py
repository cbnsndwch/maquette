import numpy as np

from voxel.palette import Palette, hex_to_rgb, rgb_to_hex, srgb_to_lab


def test_hex_roundtrip():
    assert hex_to_rgb("#2a6fb0") == (42, 111, 176)
    assert hex_to_rgb("2a6fb0") == (42, 111, 176)
    assert rgb_to_hex((42, 111, 176)) == "#2a6fb0"


def test_lab_reference_values():
    # Pure white -> L*=100, a*=b*=0; black -> L*=0.
    white = srgb_to_lab(np.array([255, 255, 255.0]))
    black = srgb_to_lab(np.array([0, 0, 0.0]))
    assert abs(white[0] - 100.0) < 1e-4
    assert abs(white[1]) < 1e-2 and abs(white[2]) < 1e-2
    assert abs(black[0]) < 1e-6


def test_nearest_slot_picks_perceptually_closest():
    pal = Palette.load("mykonos")
    # a blue near the 'accent' slot
    assert pal.nearest_slot((40, 110, 175)) == "accent"
    # a brown near 'bark'
    assert pal.nearest_slot((108, 74, 44)) == "bark"
    # near white -> primary or highlight (both very light)
    assert pal.nearest_slot((250, 248, 244)) in ("primary", "highlight")


def test_vectorized_matches_scalar():
    pal = Palette.load("mykonos")
    rgbs = np.array([[40, 110, 175], [108, 74, 44], [110, 125, 79]])
    vec = pal.nearest_slots(rgbs)
    scal = [pal.nearest_slot(r) for r in rgbs]
    assert vec == scal
