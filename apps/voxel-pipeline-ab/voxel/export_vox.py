"""Path B step 5 — write a ``VoxelUnit`` to a MagicaVoxel ``.vox`` binary.

The ``.vox`` format is a small chunked binary (MAIN > SIZE + XYZI + RGBA) with a
256-entry palette; voxel color indices are 1-based into that palette. Merged
cells (``size`` 2/3) are expanded back into solid cubes on write, since ``.vox``
has no native block-size concept. This is a minimal self-contained encoder (no
``py-vox-io`` dependency).
"""

from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path
from typing import Optional

from .palette import Palette
from .schema import VoxelUnit

FALLBACK_RGB = (160, 160, 160)


def _chunk(chunk_id: bytes, content: bytes, children: bytes = b"") -> bytes:
    return chunk_id + struct.pack("<ii", len(content), len(children)) + content + children


def _expand_voxels(unit: VoxelUnit):
    """Yield (x, y, z, material_id), expanding merged cubes into solid voxels."""
    for x, y, z, cell in unit.iter_cells():
        s = cell.size
        if s <= 1:
            yield x, y, z, cell.material_id
            continue
        for dz in range(s):
            for dy in range(s):
                for dx in range(s):
                    yield x + dx, y + dy, z + dz, cell.material_id


def to_vox_bytes(unit: VoxelUnit, palette: Palette) -> bytes:
    voxels = list(_expand_voxels(unit))

    # Assign a 1-based color index to each material used, in first-seen order.
    index_of: dict[str, int] = {}
    for _, _, _, mat in voxels:
        if mat not in index_of:
            index_of[mat] = len(index_of) + 1  # 1..255
            if len(index_of) > 255:
                raise ValueError("more than 255 distinct materials")

    # SIZE chunk (x, y, z). MagicaVoxel is z-up, matching our grid.
    sx, sy, sz = unit.dims["x"], unit.dims["y"], max(unit.dims["z"], 1)
    size_content = struct.pack("<iii", sx, sy, sz)

    # XYZI chunk.
    xyzi = struct.pack("<i", len(voxels))
    for x, y, z, mat in voxels:
        xyzi += struct.pack("<BBBB", x & 0xFF, y & 0xFF, z & 0xFF, index_of[mat])

    # RGBA chunk: 256 entries; palette index i in XYZI -> rgba[i - 1].
    rgba = bytearray(256 * 4)
    for mat, idx in index_of.items():
        rgb = palette.rgb_for(mat) if palette.has_slot(mat) else FALLBACK_RGB
        off = (idx - 1) * 4
        rgba[off : off + 4] = bytes((rgb[0], rgb[1], rgb[2], 255))

    children = (
        _chunk(b"SIZE", size_content)
        + _chunk(b"XYZI", xyzi)
        + _chunk(b"RGBA", bytes(rgba))
    )
    main = _chunk(b"MAIN", b"", children)
    return b"VOX " + struct.pack("<i", 150) + main


def save_vox(unit: VoxelUnit, palette: Palette, path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(to_vox_bytes(unit, palette))
    return path


def summarize_vox(data: bytes) -> dict:
    """Minimal parser used for verification: returns magic/version/size/voxel count."""
    if data[:4] != b"VOX ":
        raise ValueError("not a .vox file")
    version = struct.unpack_from("<i", data, 4)[0]
    info: dict = {"version": version}
    pos = 8
    pos += 12  # skip MAIN header (id + contentSize + childrenSize)
    while pos < len(data):
        cid = data[pos : pos + 4]
        content_size, _children = struct.unpack_from("<ii", data, pos + 4)
        body = pos + 12
        if cid == b"SIZE":
            info["size"] = struct.unpack_from("<iii", data, body)
        elif cid == b"XYZI":
            info["num_voxels"] = struct.unpack_from("<i", data, body)[0]
        elif cid == b"RGBA":
            used = sum(
                1
                for i in range(256)
                if data[body + i * 4 + 3] != 0
            )
            info["palette_used"] = used
        pos = body + content_size
    return info


def decode_vox(data: bytes) -> dict:
    """Parse a ``.vox`` binary into ``{size, voxels, palette}``.

    ``voxels`` is a list of ``(x, y, z, color_index)``; ``palette`` is a list of
    256 ``(r, g, b)`` tuples (color index ``i`` in a voxel maps to ``palette[i-1]``).
    """
    if data[:4] != b"VOX ":
        raise ValueError("not a .vox file")
    size = (0, 0, 0)
    voxels: list[tuple[int, int, int, int]] = []
    palette = [(0, 0, 0)] * 256
    pos = 8 + 12  # file header + MAIN header
    while pos + 12 <= len(data):
        cid = data[pos : pos + 4]
        content_size = struct.unpack_from("<i", data, pos + 4)[0]
        body = pos + 12
        if cid == b"SIZE":
            size = struct.unpack_from("<iii", data, body)
        elif cid == b"XYZI":
            n = struct.unpack_from("<i", data, body)[0]
            for i in range(n):
                x, y, z, c = struct.unpack_from("<BBBB", data, body + 4 + i * 4)
                voxels.append((x, y, z, c))
        elif cid == b"RGBA":
            palette = [
                struct.unpack_from("<BBB", data, body + i * 4)[0:3] for i in range(256)
            ]
        pos = body + content_size
    return {"size": size, "voxels": voxels, "palette": palette}


def _main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Export a VoxelUnit JSON to .vox")
    ap.add_argument("input", help="VoxelUnit JSON")
    ap.add_argument("--biome", default=None)
    ap.add_argument("--palette", default=None, help="palette name/path (default: unit biome)")
    ap.add_argument("-o", "--out", required=True)
    args = ap.parse_args(argv)

    unit = VoxelUnit.load(args.input)
    palette = Palette.load(args.palette or args.biome or unit.biome)
    out = save_vox(unit, palette, args.out)
    info = summarize_vox(out.read_bytes())
    print(f"wrote {out}: {info}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
