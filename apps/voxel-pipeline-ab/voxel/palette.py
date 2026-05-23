"""Named-slot palettes and CIE-Lab color quantization.

A palette maps biome material *slot names* (e.g. ``"primary"``, ``"bark"``) to
representative sRGB hex colors. Path B quantizes each sampled mesh color to the
nearest slot using ΔE (Euclidean distance in CIE-Lab), which tracks perceptual
difference far better than RGB distance (see the plan's color-fidelity risk).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np

PALETTES_DIR = Path(__file__).resolve().parent.parent / "palettes"


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    """Parse ``"#rrggbb"`` (or ``"rrggbb"``) into 0-255 integer RGB."""
    h = value.lstrip("#")
    if len(h) != 6:
        raise ValueError(f"expected a 6-digit hex color, got {value!r}")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def rgb_to_hex(rgb: Iterable[float]) -> str:
    r, g, b = (int(round(max(0.0, min(255.0, c)))) for c in rgb)
    return f"#{r:02x}{g:02x}{b:02x}"


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """Convert an ``(..., 3)`` array of 0-255 sRGB values to CIE-Lab (D65)."""
    rgb = np.asarray(rgb, dtype=np.float64)
    if rgb.shape[-1] != 3:
        raise ValueError("expected trailing dimension of size 3")

    # 1. sRGB [0,255] -> linear RGB [0,1]
    s = rgb / 255.0
    linear = np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)

    # 2. linear RGB -> XYZ (sRGB / D65)
    m = np.array(
        [
            [0.4124564, 0.3575761, 0.1804375],
            [0.2126729, 0.7151522, 0.0721750],
            [0.0193339, 0.1191920, 0.9503041],
        ]
    )
    xyz = linear @ m.T

    # 3. XYZ -> Lab, normalized to the D65 reference white
    white = np.array([0.95047, 1.00000, 1.08883])
    xyz = xyz / white
    eps = 216.0 / 24389.0
    kappa = 24389.0 / 27.0
    f = np.where(xyz > eps, np.cbrt(xyz), (kappa * xyz + 16.0) / 116.0)
    fx, fy, fz = f[..., 0], f[..., 1], f[..., 2]
    lab = np.stack(
        [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)], axis=-1
    )
    return lab


@dataclass
class Palette:
    """An ordered mapping of slot name -> sRGB hex, with cached Lab values."""

    name: str
    slots: dict[str, str]

    def __post_init__(self) -> None:
        if not self.slots:
            raise ValueError("palette must have at least one slot")
        self._names = list(self.slots.keys())
        rgb = np.array([hex_to_rgb(self.slots[n]) for n in self._names], dtype=np.float64)
        self._lab = srgb_to_lab(rgb)

    @property
    def slot_names(self) -> list[str]:
        return list(self._names)

    def has_slot(self, name: str) -> bool:
        return name in self.slots

    def rgb_for(self, slot: str) -> tuple[int, int, int]:
        return hex_to_rgb(self.slots[slot])

    def nearest_slot(self, rgb: Iterable[float]) -> str:
        """Slot whose color is nearest the given 0-255 RGB in Lab space."""
        lab = srgb_to_lab(np.array(rgb, dtype=np.float64).reshape(1, 3))[0]
        d = np.linalg.norm(self._lab - lab, axis=1)
        return self._names[int(np.argmin(d))]

    def nearest_slots(self, rgbs: np.ndarray) -> list[str]:
        """Vectorized :meth:`nearest_slot` for an ``(n, 3)`` array of RGB rows."""
        labs = srgb_to_lab(np.asarray(rgbs, dtype=np.float64).reshape(-1, 3))
        # (n, k) distance matrix between each input and each palette slot.
        d = np.linalg.norm(labs[:, None, :] - self._lab[None, :, :], axis=2)
        idx = np.argmin(d, axis=1)
        return [self._names[int(i)] for i in idx]

    @staticmethod
    def from_dict(name: str, slots: dict[str, str]) -> "Palette":
        return Palette(name=name, slots={k: str(v) for k, v in slots.items()})

    @staticmethod
    def load(name_or_path: str) -> "Palette":
        """Load a palette by biome name (``palettes/<name>.json``) or file path."""
        path = Path(name_or_path)
        if not path.exists():
            path = PALETTES_DIR / f"{name_or_path}.json"
        if not path.exists():
            raise FileNotFoundError(
                f"palette not found: {name_or_path!r} (looked in {PALETTES_DIR})"
            )
        raw = json.loads(path.read_text(encoding="utf-8"))
        slots = raw.get("slots", raw)
        return Palette.from_dict(raw.get("name", path.stem), slots)
