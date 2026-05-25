# PRD — In-Tile Resolution Multiplier

**Status:** Draft · **Sequence:** After [multi-cell footprint](./multi-cell-footprint-tiles.md) ships and is tested on a couple of buildings
**Owners:** TBD · **Last updated:** 2026-05-25

## 1. Summary

Tiles are authored at a fixed **12 voxels per cell edge**. For ornate assets that
need more detail, raise the *resolution* of a tile without changing the world cell
size. The governing identity:

```
world units per cell  =  VOXEL_PER_TILE × VOXEL_SIZE   (currently 12 × 1 = 12 = P)
```

To pack more detail into the **same** world cell, raise the voxel count and shrink
the voxel size by the same factor so `P` is unchanged:

| | voxels/cell (`r`) | voxelSize | world cell `P` |
|---|---|---|---|
| now | 12 | 1.0 | 12 |
| 2× detail | 24 | 0.5 | 12 |

This is the **per-asset** approach (chosen over a global bump): only the assets that
need detail pay the ~4× voxel cost; terrain stays at `r=12`; **no catalog-wide
re-authoring**. Each asset declares its own resolution, and `.vox` SIZE-chunk dims
already record the true voxel extents (`VoxAsset.dims`), so the data is there.

## 2. Goals / Non-Goals

**Goals**
- A tile can declare a resolution `r` (voxels per cell edge), default `12`.
- A higher-`r` asset renders inside the **same** world cell footprint as a `12`
  asset — finer cubes, same physical size.
- Mixed resolutions coexist in one scene (12 terrain + 24 building).
- Author higher-res tiles in the editor and via the MCP builder.
- Persist `resolution` in the catalog; load identically.

**Non-Goals**
- A global resolution change (we explicitly reject coarsening the whole grid).
- Changing `VOXEL_SIZE`/`P` as the world-cell anchor — `P` stays the constant; only
  per-asset `voxelSize = P/r` varies.
- Non-power-of-two or per-axis resolutions (keep `r` a single multiple of 12, e.g.
  12/24/36/48).

## 3. Dependency on the footprint PRD

Resolution and footprint **both multiply the `.vox` dims**:

```
dims[0] = r · footprintW
dims[1] = r · footprintD
```

You cannot derive one from `dims` without knowing the other, so both must be
explicit catalog fields. The footprint PRD introduces the explicit-`footprint`-field
convention and the `dims` validation; this PRD extends that validation to
`dims[0] === r · footprint[0]`. That ordering is why footprint goes first.

The two also combine at the render seam: footprint gives the rectangular rotation
**span** (`r·w`, `r·d`); resolution gives the per-asset **cube size** (`P/r`).

## 4. Where resolution is consumed

| Area | File | Change |
|---|---|---|
| Constants | `libs/scene-author/src/constants.mts` | `VOXEL_PER_TILE` becomes the **base** resolution; `P = VOXEL_PER_TILE × VOXEL_SIZE` stays the world-cell anchor. Add a base constant + per-asset `r`. |
| Catalog | `catalog.mts`, `catalog.json`, save paths | add `resolution?: number` (default 12); persist in both writers. |
| Scene render | `scene-view.ts` | group placements by `r` → one `VoxelBatch` per distinct `voxelSize = P/r`, with `span = r·footprint`. |
| Column base math | `scene-view.ts#columnBaseZ` / `cellHeight` | base accumulation must move to **world units** (mixed `r` in a column). |
| Ground datum | `constants.mts#GROUND_LAYERS`, editor datum | buried depth must be expressed in **world units**; high-`r` tiles bury proportionally more voxel layers. |
| `.vox` export | `export-vox.mts` | mixed-resolution bake onto a **common grid** (upscale). |
| Editor | `tile-editor.ts` | author at `r×r` (× footprint); datum line scales by `r`; framing by voxel count. |
| MCP | `tile-builder.mts`, `tools.mts` | `resolution` param; `analyzeTile` footprint check + `dims` use `r·N`. |
| `.vox` codec limits | `voxel-prop.mts#encodeVox` | enforce `r·max(w,d) ≤ 256` and `z ≤ 256`. |

## 5. Hairy things & edge cases

### 5.1 Mixed-resolution column stacking (the big one)
Today a column's base altitude is accumulated in **voxel units** (`columnBaseZ` sums
`cellHeight = dims[2]`, multiplied by the single global `CONFIG.voxel.size` at use).
Once cells in a column have different `r`, "voxel units" are no longer comparable —
a 24-res cell's voxel is half the height of a 12-res cell's.

→ **All base/altitude math must move to world units.** A cell's world height is
`dims[2] × (P/r)`. `columnBaseZ` returns world Y; render origins use world Y
directly. Audit every `* CONFIG.voxel.size` site — they assume one global size.

### 5.2 Ground-datum alignment across resolutions
`GROUND_LAYERS = 4` is "bury the lowest 4 voxel layers." For a 24-res tile, burying
the same **world depth** means burying `4 · (24/12) = 8` of its layers. The datum is
a single world plane at `y = -GROUND_LAYERS · VOXEL_SIZE`. So:
- The buried-layers convention must be defined in **world units** (depth = constant),
  not a voxel count.
- A high-`r` tile authored to meet the datum must place its `z=0` so that
  `buried_world_depth` matches. The editor's datum plane must show at the scaled
  layer (`GROUND_LAYERS · r/12`).
- Get this wrong and high-res buildings float or sink relative to terrain.

### 5.3 `.vox` scene export onto a common grid
`composeSceneVoxels` bakes onto **one** integer voxel grid with `SPAN = 12`. Mixed
`r` means assets have different voxel pitch — they can't share a 12-grid losslessly.
Options:
- **Bake at the max resolution present**, nearest-neighbour upscaling lower-res
  assets (each base voxel → `(R/r)³` block). Preserves detail; larger file.
- Bake at base 12 and downsample high-res assets (loses the detail we added — bad).

Recommend **bake at max resolution, upscale others**. Watch the 256-axis cap:
`14 cells × 24 = 336 > 256` already overflows for a full island at `r=24`. So the
whole-scene `.vox` export may need a documented limit (e.g. export a region, or cap
island size when high-res is present).

> **Decision needed (R1):** common-grid bake at max-`r` with upscaling; define
> behaviour when `gridCells × maxR > 256`.

### 5.4 `.vox` 256-per-axis cap
`encodeVox` already throws above 256. Per **tile**, `r · max(w,d) ≤ 256`: a 4×4
villa at `r=24` = 96 (fine); at `r=64` = 256 (limit). Validate at save. Per **scene**
export, see §5.3.

### 5.5 Editor unit-cube assumption
`tile-editor.ts` displays voxels via `VoxelBatch(CONFIG.voxel.size)` but its hit
mesh, selection mesh, and edge overlay are **hardcoded unit cubes** (`BoxGeometry(1,1,1)`,
`selGeo` 1.12, edge template from `hitGeo`) positioned at `v.x + 0.5`. These only
line up today because `size === 1`. For authoring, the clean fix is to keep the
editor in **pure voxel space** (`VoxelBatch(1)`, everything at unit scale) and frame
the camera by **voxel count** `N` rather than world `P`, so it's independent of the
asset's render `voxelSize`. The `r` only affects how many voxels you author and where
the datum line sits (§5.2).

### 5.6 Vertical budget (z cap)
The editor's `z >= 64` cap is in voxel units; higher `r` eats world height faster
(64 layers at `r=24` = 32 world units vs 64 at `r=12`). Either express the cap in
world height or scale it by `r`. Confirm `.vox` `z ≤ 256` still holds.

### 5.7 Render-batch grouping cost
`rebuildNow`/`onPlaced`/`updateGhost` build a single `VoxelBatch`. Per-asset size is
batch-global (constructor arg), so mixed `r` needs **one batch per distinct
resolution** (size = `P/r`). A handful of extra instanced meshes — draw calls stay
low. `span` is already per-`add`, so footprint rotation rides along.

### 5.8 Thumbnails / headless render
`renderThumbnail` and the MCP `render_*` tools frame by bounding box, so they're
visually resolution-independent — but confirm no framing math assumes 12.

### 5.9 Backwards compatibility
`resolution` defaults to 12; every existing tile is unaffected. The only behavioural
change for legacy tiles is the base-math move to world units, which must be a no-op
when all `r=12` (regression guard).

## 6. Test plan

- Author a 1×1 prop at `r=24`; place among `r=12` terrain; confirm it occupies the
  **same** world cell footprint and meets the ground datum exactly.
- Stack a high-res cell on a low-res riser; confirm base height in **world units**.
- Combine with footprint: a 2×2 building at `r=24` (48×48) rotates and places
  correctly.
- `.vox` scene export with mixed resolutions round-trips (per R1 policy); verify the
  256-cap guard fires gracefully.
- Per-tile save: `r·max(w,d) > 256` is rejected with a clear message.
- **Regression:** an all-`r=12` scene renders and exports bit-identically to pre-change.

## 7. Open decisions (lock before coding)

- **R1** Common-grid scene-export policy (max-`r` upscale) + behaviour past the
  256-axis cap.
- **R2** Allowed `r` values (multiples of 12 only? 12/24/36/48 enum?).
- **R3** Express `GROUND_LAYERS` and the editor z-cap in world units vs scaled voxel
  counts.
- **R4** Editor: refactor to pure-voxel-space + frame-by-count (recommended) vs
  scale hit/selection/edge meshes by `voxelSize`.
