"""Path A — LLM-native JSON voxels.

A frontier LLM emits the voxel grid directly as JSON. The model id is read from
the environment (``VOXEL_LLM_MODEL`` / ``ANTHROPIC_MODEL``) and never hardcoded,
matching the rest of the repo's LLM adapters. On any failure (no API key,
malformed JSON after retries) it falls back to the nearest Path A skeleton, so
the CLI always produces a usable unit offline.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from typing import Optional

from . import skeletons
from .palette import Palette
from .schema import VoxelUnit
from .validate_unit import format_stats, normalize, parse_unit_text

SCHEMA_HINT = """\
{
  "id": string,
  "biome": string,
  "cells": (Cell|null)[][][],   // indexed [z][y][x]; null = empty
  "pivot": { "x": number, "y": number }
}
where Cell = { "materialId": string, "size"?: 1 }
"""


def build_system_prompt() -> str:
    return (
        "You are a voxel artist designing small, blocky props for a stylized "
        "Mediterranean island scene. You output ONLY a single JSON object and no "
        "prose. The grid footprint is fixed at 12x12 (x and y); height (z) is "
        "variable. Cells are indexed [z][y][x]; z=0 is the ground layer. Use null "
        "for empty cells. Keep shapes readable from an isometric top-down view, "
        "flat-shaded, with no floating cells and no overhangs unless structurally "
        "intentional (e.g. an arch)."
    )


def build_user_prompt(
    description: str,
    palette: Palette,
    height_budget: int,
    biome: str,
) -> str:
    slots = ", ".join(palette.slot_names)
    return (
        f"Object: {description}\n"
        f"Biome: {biome}\n"
        f"Height budget: at most {height_budget} z-layers (you may use fewer).\n"
        f"Allowed materialId values (palette slots): {slots}\n\n"
        f"Output a JSON object matching this schema:\n{SCHEMA_HINT}\n"
        "Rules:\n"
        "- materialId MUST be one of the allowed palette slots above.\n"
        "- null = empty cell.\n"
        "- Every z-layer must be a 12x12 array of (Cell|null).\n"
        "- Center the object near pivot [6, 6].\n"
        "- Output JSON only — no markdown, no commentary."
    )


@dataclass
class GenResult:
    unit: VoxelUnit
    source: str  # 'llm' | 'skeleton-fallback'
    attempts: int
    warnings: list[str]


def _resolve_model(explicit: Optional[str]) -> Optional[str]:
    return explicit or os.environ.get("VOXEL_LLM_MODEL") or os.environ.get("ANTHROPIC_MODEL")


def _call_llm(model: str, system: str, user: str, client=None) -> str:
    """Single LLM call returning raw text. Lazily imports the Anthropic SDK."""
    if client is None:
        import anthropic  # lazy: optional dependency

        client = anthropic.Anthropic()
    resp = client.messages.create(
        model=model,
        max_tokens=8192,
        # Cache the (stable) system prompt across retries / calls.
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user}],
    )
    return "".join(block.text for block in resp.content if getattr(block, "type", None) == "text")


def fallback_skeleton(description: str, biome: str, palette: Palette) -> VoxelUnit:
    name = skeletons.match(description)
    unit = skeletons.get(name)
    unit.id = name
    unit.biome = biome
    unit.metadata = {**unit.metadata, "source": "skeleton-fallback", "matched": name}
    return normalize(unit, palette, remap_unknown=True).unit


def generate(
    description: str,
    biome: str,
    palette: Palette,
    *,
    height_budget: int = 18,
    max_retries: int = 3,
    model: Optional[str] = None,
    client=None,
) -> GenResult:
    """Generate a VoxelUnit for ``description`` via LLM, falling back to a skeleton."""
    resolved = _resolve_model(model)
    have_key = bool(os.environ.get("ANTHROPIC_API_KEY")) or client is not None

    if not resolved or not have_key:
        reason = "no model configured" if not resolved else "no ANTHROPIC_API_KEY"
        unit = fallback_skeleton(description, biome, palette)
        return GenResult(unit, "skeleton-fallback", 0, [f"{reason}; used skeleton"])

    system = build_system_prompt()
    user = build_user_prompt(description, palette, height_budget, biome)
    warnings: list[str] = []

    for attempt in range(1, max_retries + 1):
        try:
            text = _call_llm(resolved, system, user, client=client)
            unit = parse_unit_text(text)
            unit.id = unit.id or skeletons.match(description)
            unit.biome = biome
            result = normalize(unit, palette, height_budget=height_budget)
            if result.ok:
                result.unit.metadata = {
                    **result.unit.metadata,
                    "source": "llm",
                    "model": resolved,
                    "attempts": attempt,
                }
                return GenResult(result.unit, "llm", attempt, result.warnings)
            # Feed the validation errors back into the next attempt.
            user += f"\n\nThe previous output had errors: {result.errors}. Fix them."
            warnings.extend(result.errors)
        except Exception as exc:  # noqa: BLE001 — retry on any LLM/parse failure
            warnings.append(f"attempt {attempt}: {exc}")
            user += f"\n\nThe previous output failed to parse: {exc}. Output valid JSON only."

    unit = fallback_skeleton(description, biome, palette)
    warnings.append(f"LLM failed after {max_retries} attempts; used skeleton")
    return GenResult(unit, "skeleton-fallback", max_retries, warnings)


def _main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Path A — generate a VoxelUnit via LLM.")
    ap.add_argument("--desc", required=True, help="object description")
    ap.add_argument("--biome", default="mykonos")
    ap.add_argument("--palette", default=None, help="palette name/path (default: --biome)")
    ap.add_argument("--height-budget", type=int, default=18)
    ap.add_argument("--max-retries", type=int, default=3)
    ap.add_argument("--model", default=None, help="override VOXEL_LLM_MODEL")
    ap.add_argument("-o", "--out", help="write the unit JSON here")
    args = ap.parse_args(argv)

    palette = Palette.load(args.palette or args.biome)
    result = generate(
        args.desc,
        args.biome,
        palette,
        height_budget=args.height_budget,
        max_retries=args.max_retries,
        model=args.model,
    )
    print(f"source: {result.source} (attempts={result.attempts})", file=sys.stderr)
    for w in result.warnings:
        print(f"  warning: {w}", file=sys.stderr)
    print(format_stats(result.unit), file=sys.stderr)

    if args.out:
        out = result.unit.save(args.out)
        print(f"wrote {out}", file=sys.stderr)
    else:
        print(json.dumps(result.unit.to_dict()))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
