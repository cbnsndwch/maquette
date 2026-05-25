# PRD — Multi-Cell Footprint Tiles

**Status:** Draft · **Sequence:** Do this first (resolution multiplier follows)
**Owners:** TBD · **Last updated:** 2026-05-25

## 1. Summary

Today every tile is locked to a single grid column: **1 tile = 1 cell = a fixed
12×12 voxel footprint**. We're about to model buildings, several of which are
larger than one cell:

| Building | Footprint (cells) |
|---|---|
| bridge | 2×1 |
| house / cube house / altar / tower chapel / windmill | 2×2 |
| terrace house | 3×2 |
| main chapel / pergola house | 3×3 |
| main villa | 4×4 |

This PRD adds **multi-cell footprint tiles**: a single asset that occupies a
`w × d` block of grid cells, authored at a `(w·12) × (d·12)` voxel footprint,
placed/erased/rotated/picked as one unit, and rendered + exported once from an
anchor cell.

A 4×4 villa is already 48×48 voxels at the current 12-resolution, so this change
*also* buys large buildings a big detail budget on its own — the separate
[resolution-multiplier PRD](./tile-resolution-multiplier.md) is deliberately
deferred until this lands and is proven on a couple of buildings.

## 2. Goals / Non-Goals

**Goals**
- A tile can declare a rectangular footprint `[w, d]` in cells (default `[1, 1]`).
- Author a footprint tile in the editor and via the MCP tile-builder.
- Place it as one atomic unit with footprint-aware collision + bounds checks.
- Rotate it (a `w×d` footprint becomes `d×w` at 90°/270°).
- Erase / pick / undo / redo it as one unit from *any* covered cell.
- Render once (scene view) and bake once (`.vox` export) — never double-draw.
- Persist footprint in the catalog and the scene save format; load identically.

**Non-Goals (v1)**
- Stacking other tiles **on top of** a building roof (buildings are non-stackable).
- Higher in-tile resolution — that's the follow-up PRD. v1 stays at 12 voxels/cell.
- Non-rectangular (L-shaped) footprints.
- Footprints that span a *variable* height per covered cell (we require a single
  base level under the whole footprint — see §5.2).

## 3. The invariant we are breaking

"1 tile = 1 column = square 12×12" is assumed in many places. Every one of these
is in scope:

| Area | File | Assumption to generalize |
|---|---|---|
| Shape constants | `libs/scene-author/src/constants.mts` | `VOXEL_PER_TILE = 12`, square |
| Grid data model | `libs/scene-author/src/tile-map.mts` | `TerrainState = TerrainCell[][]`, one stack per `(gx,gy)`; `TerrainCell = {id,rot}` has no footprint/occupancy |
| Placement | `libs/scene-author/src/placement-system.mts` | single-cell `checkPlace`/`place`/`erase` |
| Scene render | `apps/three-scene/src/core/scene-view.ts` | `cellOrigin`/`cellCenter`/`columnBaseZ`/hover/ghost/pop/raycast all per single cell; `span = perTile` |
| `.vox` export | `libs/scene-author/src/export-vox.mts` | per-column compose, `SPAN = 12`, `gx*SPAN`; `rotateXY` uses one square span |
| Batch rotation | `libs/world-core/src/voxel.mts` | `VoxelBatch.add` rotation uses a single scalar `span` (square only) |
| Editor | `apps/three-scene/src/core/tile-editor.ts` | `N = 12` square author grid, bounds, floor, datum hole |
| MCP builder | `apps/world-mcp/src/tile-builder.mts` | `analyzeTile` footprint check + `dims` are `N×N` |
| MCP tools | `apps/world-mcp/src/tools.mts` | `create_tile` "fixed NxN"; `place_tile` single cell |
| Catalog schema | `catalog.json`, `TerrainDef` | no `footprint` field |
| Save paths | `apps/three-scene/vite-tiles-plugin.ts`, `apps/world-mcp/src/tile-store.mts` | neither persists footprint (TileDef rebuilt inline in **two** places) |
| Scene save | `tile-map.mts#serialize`, `storage/save-system.ts` | format is `{width,height,terrain: stacks}` |

## 4. Data model — the central decision

A multi-cell tile must rest at **one** altitude across all covered columns, which
breaks the "each column is an independent stack" premise. Two ways to store it:

### Option A — Anchor + occupancy markers (in the existing stacks)
The tile is stored once at its **anchor** (the min-corner `(ax, ay)`) as a cell
that carries its footprint; each other covered cell holds an *occupancy marker*
referencing the anchor. Render/pick/erase resolve markers back to the anchor.

- Pros: one grid, one source of truth, reuses the stack model.
- Cons: `TerrainCell = {id, rot}` can't express "occupied by anchor at (ax,ay)" —
  needs a new cell variant; distorts the meaning of "column stack."

### Option B — Separate building placements layer (recommended)
Keep `TerrainState` stacks exactly as-is for 1×1 terrain/nature/props. Add a
second list on the document:

```ts
interface BuildingPlacement {
  id: string;
  ax: number; ay: number;   // anchor (min-corner) cell
  rot: Rotation;
  baseLevel: number;        // voxel altitude its z=0 sits at (see §5.2)
}
```

- Pros: the terrain stack code is untouched and low-risk; buildings are a clean
  overlay (mirrors how nature/props are already a special "ground-anchored"
  case); collision is a separate occupancy index built from the placements.
- Cons: two systems to consult for "what's at this cell"; pick/erase/fill must
  check both.

**Recommendation: Option B.** It isolates the risky change from the proven terrain
path and matches the existing "anchored category" pattern. The rest of this PRD
assumes B; call out the decision explicitly before coding because it drives the
save-schema change (§7).

> **Decision needed (D1):** A or B. (Recommend B.)

## 5. Hairy things & edge cases

### 5.1 Footprint rotation (non-square)
A `w×d` footprint rotated 1 or 3 quarter-turns becomes `d×w`. Two consequences:

- **Occupied cells change shape.** Collision, hover, and the occupancy index must
  use the *rotated* footprint dims, not the authored ones.
- **Voxel rotation needs two dims.** `VoxelBatch.add` and `export-vox#rotateXY`
  currently take a single scalar `span` and compute `span-1-x` / `span-1-y` — only
  correct for **square** footprints. The legacy `build-scene.mts` multi-cell path
  was square-only (`span: s.footprint * perTile`). Our 2×1 bridge and 3×2 terrace
  are non-square, so we must extend the rotation to `(spanX, spanY)`:
  - rot 1: `(x,y) → (y, spanX-1-x)` and the footprint becomes `d×w`
  - rot 2: `(x,y) → (spanX-1-x, spanY-1-y)`
  - rot 3: `(x,y) → (spanY-1-y, x)`
  - Verify against `VoxelBatch`'s existing square formulas so square tiles are
    bit-identical after the change (regression guard).

> **Decision needed (D2):** extend `VoxelBatch`/`rotateXY` to rectangular spans
> (required for 2×1, 3×2). No square-only shortcut.

### 5.2 Base height under a footprint (unequal columns)
A footprint may cover columns of different stack heights. Define the rule:
- **Reject** if covered columns aren't level (simplest, predictable), **or**
- **Clamp to max** covered height and let the building bridge the gap, **or**
- **Require flat ground** (all covered cells empty or equal).

`baseLevel` in the placement is the agreed altitude. Recommend **reject unless all
covered cells are level** for v1 (clear feedback, no hidden geometry). Revisit if
authors hate it.

> **Decision needed (D3):** base-height rule. (Recommend reject-unless-level.)

### 5.3 Placement / collision (atomic)
`checkPlace(id, gx, gy, rot)` for a footprint tile must:
1. Compute the rotated footprint cell set from the anchor.
2. Reject if **any** cell is out of bounds (`out_of_bounds`).
3. Reject if **any** cell is occupied by another building or a non-compatible
   stack (`occupied` / new reason).
4. Apply the base-height rule (§5.2) → `not_level` (new reason).
5. Reserve **all** cells or **none** (no partial placement).

Edge cases: footprint hanging off any edge; overlapping another building; overlapping
its own previous position during a move; a 1×1 tile dropped into a building's
footprint (must reject); `fill_terrain` must skip building-occupied cells.

New `PlacementError` variants: `occupied`, `not_level`. Keep them machine-readable
for the MCP self-correction loop.

### 5.4 Erase / pick as a unit
- Clicking *any* covered cell erases the *whole* building.
- `cellFromClient` returns the raw cell; resolve it through the occupancy index to
  the anchor before erase/inspect.
- Undo/redo: one building place or erase is **one** history step. With Option B the
  snapshot must include the placements list (see §7).

### 5.5 Scene rendering (`scene-view.ts`)
- Render each building **once** at its anchor origin, spanning `w·P × d·P` world
  units, with rectangular rotation.
- Hover highlight quad must size to the rotated `w·P × d·P` and sit at `baseLevel`.
- Ghost preview likewise (and tint invalid if §5.3 fails).
- Placement pop scales from the **footprint center**, not the cell center.
- `cellOrigin` is anchor-based; building voxels legitimately extend beyond a single
  cell — make sure nothing clamps them to one cell's span.
- Performance: a 4×4 villa is ~48×48×H voxels; it still bakes into the one instanced
  batch (draw calls stay flat), but watch instance counts.

### 5.6 `.vox` scene export (`export-vox.mts`)
- Emit building voxels **once at the anchor**: `x = ax*SPAN + rx`, where `rx` ranges
  `0..(w·SPAN-1)` (crosses cell boundaries — fine). Skip occupancy cells so nothing
  double-emits.
- Rotation uses the rectangular form (§5.1).
- This stays single-resolution (12), so the export grid is uniform — **no** mixed-
  grid complication here (that's the resolution PRD's problem). The min-corner
  normalization is unchanged.

### 5.7 Editor authoring (`tile-editor.ts`)
- Generalize `N` → `Nx = w·12`, `Ny = d·12` (and `HALF` per axis). Touches: bounds
  checks (`addVoxel`, `moveSelection`, `floorCell`), the floor `GridHelper`, the
  datum-plane hole (now rectangular), and `fillBase`/`clearBase` loops.
- Camera `frameEdit` should frame `max(w,d)·P`.
- Choosing footprint: the **New Tile** form needs `w`/`d` selectors (buildings only?
  or any category). Loading an existing building reads `def.footprint` to set
  `Nx,Ny`.
- The editor works in pure voxel space at `size = 1`, so this part is footprint-only;
  no voxel-size interaction until the resolution PRD.

### 5.8 MCP authoring path
- `create_tile` accepts `footprint: [w,d]` (default `[1,1]`); its description and the
  returned `footprint`/`conventions` must reflect `Nx×Ny`.
- `analyzeTile` `outOfFootprint` uses `0..Nx-1 / 0..Ny-1`; `dims = [Nx, Ny, h]`.
- `place_tile` / `can_place` perform footprint reservation + the new rejection
  reasons.
- `get_grid_info` documents footprint placement rules.
- `save_tile` persists `footprint` to the catalog.

### 5.9 Catalog + dims consistency
- Add `footprint?: [number, number]` to `TerrainDef` (default `[1,1]`).
- **Do not derive footprint from `.vox` dims.** `dims[0]/12` is ambiguous once the
  resolution multiplier exists (`dims[0] = resolution · w`). Footprint is an
  explicit catalog field; validate `dims[0] === footprint[0]·12` and
  `dims[1] === footprint[1]·12` at save time (v1, before resolution exists).
- `VoxelAssets.dims` already returns real SIZE-chunk dims — reuse for the span.

## 6. Touched files (implementation checklist)

- `libs/scene-author/src/catalog.mts` — `footprint` on `TerrainDef`, default + getter.
- `libs/scene-author/src/tile-map.mts` — building placements list (Option B),
  occupancy index, serialize/restore/snapshot include it.
- `libs/scene-author/src/placement-system.mts` — footprint reservation, new reasons,
  building-aware erase/fill.
- `libs/world-core/src/voxel.mts` — rectangular `(spanX,spanY)` rotation.
- `libs/scene-author/src/export-vox.mts` — anchor-once emit, rectangular rotation.
- `apps/three-scene/src/core/scene-view.ts` — anchor render, footprint hover/ghost/
  pop, occupancy-aware pick.
- `apps/three-scene/src/core/tile-editor.ts` — `Nx/Ny` author grid, datum, camera.
- `apps/three-scene/src/core/game.ts` — place/erase route through footprint;
  undo grouping for a building.
- `apps/three-scene/src/components/EditorPanel.tsx` + `core/tile-save.ts` +
  `actions.ts` — footprint in `TileMeta` + POST body.
- `apps/three-scene/vite-tiles-plugin.ts` — persist `footprint` in `handlePost`.
- `apps/world-mcp/src/tile-builder.mts`, `tools.mts`, `tile-store.mts` — footprint
  end-to-end on the headless path.

## 7. Save-format / migration

- **Catalog** (`catalog.json`): additive (`footprint`), back-compat (missing ⇒
  `[1,1]`). Both writers (`vite-tiles-plugin#handlePost`, `tile-store#saveTileToDisk`)
  reconstruct the `TileDef` inline — add the field in **both**.
- **Scene document**: Option B adds a `buildings` array to
  `TileMap.serialize()`/`load()`. Old saves lack it ⇒ treat as empty. Bump
  `CONFIG.storageKey` `…save.v2` → `…save.v3`; decide whether to migrate or drop old
  local scenes (recommend drop — only dev scenes exist).

> **Decision needed (D4):** migrate vs drop existing localStorage scenes on the
> schema bump.

## 8. Test plan

- Place 2×2 house at a corner and mid-grid; rotate 0/1/2/3; confirm covered cells,
  render position, and that nothing double-draws.
- Non-square 2×1 bridge and 3×2 terrace: rotation lands the footprint correctly.
- Collision: off-grid reject; overlap-another-building reject; unequal-height reject
  (per D3); 1×1 tile into a footprint rejects.
- `fill_terrain` skips building cells.
- Erase from each covered cell removes the whole building; undo/redo restores it as
  one step.
- `.vox` export round-trips (decode → re-encode identical) with a building present.
- Save → reload scene (schema v3) with a building.
- MCP: `create_tile` w,d → `add_shape` → `analyzeTile` footprint check → `save_tile`
  persists footprint → `place_tile` reserves → `finalize_scene` bakes once.
- **Regression:** all existing 1×1 tiles render and export bit-identically (the
  rectangular-rotation refactor must not change square output).

## 9. Open decisions (lock before coding)

- **D1** Storage model: anchor+occupancy (A) vs separate placements layer (B). *Rec: B.*
- **D2** Rectangular rotation in `VoxelBatch`/`rotateXY`. *Rec: yes, required.*
- **D3** Base-height rule under a footprint. *Rec: reject-unless-level.*
- **D4** Existing-scene migration on schema bump. *Rec: drop.*
- **D5** Is footprint selectable for all categories or buildings-only in the editor?
- **D6** Footprint source of truth = explicit catalog field + dims validation. *Rec: yes.*
