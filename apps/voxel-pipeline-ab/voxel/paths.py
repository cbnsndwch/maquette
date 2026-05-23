"""Shared path helpers for the voxel pipeline app."""

from __future__ import annotations

from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
WORKFLOWS_DIR = APP_DIR / "workflows"
SKELETONS_DIR = APP_DIR / "skeletons"
PALETTES_DIR = APP_DIR / "palettes"


def repo_root() -> Path:
    """Walk up from the app dir to the monorepo root (has pnpm-workspace.yaml)."""
    for parent in [APP_DIR, *APP_DIR.parents]:
        if (parent / "pnpm-workspace.yaml").exists():
            return parent
    return APP_DIR.parents[1]


def local_dir() -> Path:
    """The gitignored ``.local`` scratch dir at the repo root."""
    return repo_root() / ".local"


def external_repos_dir() -> Path:
    """Where ComfyUI / TripoSR are cloned (``.local/repos``)."""
    return local_dir() / "repos"


def staging_dir() -> Path:
    """App-local working dir for intermediate concept images / meshes."""
    return APP_DIR / "staging"


def out_dir() -> Path:
    """App-local output dir for generated units / .vox files."""
    return APP_DIR / "out"
