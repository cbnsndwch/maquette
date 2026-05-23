"""Pipeline benchmark (Phase 5 target: < 30 s/asset).

Times the locally-runnable stages so regressions are visible. The GPU front-half
of Path B (ComfyUI image gen + TripoSR mesh) is excluded — it depends on external
models — so Path B here is the mesh -> voxel -> merge -> .vox tail measured on a
synthetic mesh.
"""

from __future__ import annotations

import argparse
import statistics
import sys
import tempfile
import time
from pathlib import Path

from .chunk_merge import merge
from .export_vox import save_vox
from .palette import Palette
from .skeletons import REGISTRY, get
from .validate_unit import normalize


def _time(fn, n: int) -> tuple[float, float]:
    samples = []
    for _ in range(n):
        t0 = time.perf_counter()
        fn()
        samples.append(time.perf_counter() - t0)
    return statistics.mean(samples), max(samples)


def bench_path_a(palette: Palette, n: int, out_dir: Path) -> dict:
    names = list(REGISTRY)

    def one():
        name = names[bench_path_a.i % len(names)]
        bench_path_a.i += 1
        unit = get(name)
        unit = normalize(unit, palette, remap_unknown=True).unit
        unit = merge(unit)
        save_vox(unit, palette, out_dir / f"bench-{name}.vox")

    bench_path_a.i = 0
    mean, peak = _time(one, n)
    return {"stage": "path-a (skeleton->merge->vox)", "mean_s": mean, "peak_s": peak}


def bench_path_b_tail(palette: Palette, n: int, out_dir: Path) -> dict:
    import numpy as np
    import trimesh

    from .voxelize import voxelize

    box = trimesh.creation.box(extents=(2.0, 3.0, 2.0))
    box.visual.vertex_colors = np.tile([110, 125, 79, 255], (len(box.vertices), 1)).astype(np.uint8)
    mesh_path = out_dir / "bench-mesh.obj"
    box.export(mesh_path)

    def one():
        unit = voxelize(str(mesh_path), palette, unit_id="bench", biome=palette.name, fill=True)
        unit = merge(unit)
        save_vox(unit, palette, out_dir / "bench-pathb.vox")

    mean, peak = _time(one, n)
    return {"stage": "path-b tail (voxelize->merge->vox)", "mean_s": mean, "peak_s": peak}


def _main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Benchmark the runnable pipeline stages.")
    ap.add_argument("--biome", default="mykonos")
    ap.add_argument("-n", "--iterations", type=int, default=20)
    args = ap.parse_args(argv)

    palette = Palette.load(args.biome)
    with tempfile.TemporaryDirectory() as tmp:
        out_dir = Path(tmp)
        results = [
            bench_path_a(palette, args.iterations, out_dir),
            bench_path_b_tail(palette, max(3, args.iterations // 4), out_dir),
        ]

    print(f"benchmark ({args.iterations} iters, biome={args.biome}):", file=sys.stderr)
    for r in results:
        ok = "OK" if r["peak_s"] < 30 else "SLOW"
        print(
            f"  [{ok}] {r['stage']:<38} mean={r['mean_s']*1000:7.1f} ms  peak={r['peak_s']*1000:7.1f} ms",
            file=sys.stderr,
        )
    print("  note: Path B GPU front-half (image+TripoSR) not included.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
