# Walkable, RPG-Style Navigation

**Status:** design proposal · 2026-05-23
**Depends on:** `libs/contracts` (`WorldSpec`, tile types), `libs/world-core` (`buildScene`), `apps/web`

**TL;DR**

- Everything needed for walkability is already in the `WorldSpec`: a tile grid + heightmap. Derive a **nav grid** (passable tiles + step heights) from it, in a renderer-agnostic `world-nav` module.
- Movement fits a grid model: **A\* pathfinding** (click-to-move) or WASD with per-tile height-snap; allow elevation steps only where the height delta is small **or** a `stairs` tile bridges them (the `stairs` type already exists but is purely cosmetic today).
- Swap the auto-rotating `OrbitControls` for a **third-person / isometric follow camera** tracking a simple avatar.
- This pairs with chunk streaming (doc 2) — the nav grid spans loaded chunks, so walking to an edge grows the world — and with the track descriptor (doc 1): `sections`/`lyrics` enable a "walk the song" timeline.

---

## Current state

- `buildScene` (`libs/world-core/src/build-scene.mts`) returns a static `THREE.Scene`; tiles are extruded boxes, props are simple meshes.
- `apps/web/src/main.ts` uses `OrbitControls` with `autoRotate` — a viewer, not a player.
- The `WorldSpec` already carries `tiles[y][x].type` and `terrain.heightmap[y][x]` — enough to compute passability and ground height with no extra data.
- `stairs` is a defined `TileType` but unused for gameplay; it's the natural elevation-bridge affordance.

## Walkability derivation

A pure function over the spec (no rendering):

```ts
// libs/world-nav
interface NavGrid {
    isWalkable(x: number, y: number): boolean;
    heightAt(x: number, y: number): number;     // world units
    canStep(from: Cell, to: Cell): boolean;      // height-delta / stairs rule
    findPath(from: Cell, to: Cell): Cell[] | null; // A*
}
function buildNavGrid(spec: WorldSpec, opts): NavGrid;
```

Passability table (from tile type):

| Walkable | Blocked |
| --- | --- |
| sand, grass, plaza, path, rock, stairs | water, wall, rooftop, dome |

`canStep(from, to)` allows a move when `to` is walkable **and** (`abs(heightAt(to) - heightAt(from)) <= stepThreshold` **or** either tile is `stairs`). This makes `stairs` the only way up steep building tiers — exactly its intended role.

## Movement models

**A) Grid-based + A\* (recommended).** Movement is cell-to-cell; pathfinding is A* over the nav grid (Manhattan/diagonal heuristic, `canStep` as the edge test). Click-to-move feels classic-RPG; WASD can also drive it (queue the adjacent cell). The avatar interpolates position + snaps Y to `heightAt`. Deterministic, cheap, and robust on a blocky world.

**B) Free physics movement.** A capsule with raycast-down for ground height + slope limit, via a physics lib (Rapier/cannon-es) or hand-rolled raycasting against the tile meshes. Smoother, but heavier and overkill for a tile diorama. Defer.

**Recommendation:** A. It matches the aesthetic and needs no physics dependency.

## Camera & avatar

- Replace `OrbitControls` with a **third-person/isometric follow camera**: fixed pitch/yaw offset (optionally rotatable), smoothly lerping to `avatar.position + offset`, reusing the angle from `suggestCameraPosition()`.
- Avatar: a capsule/low-poly figure now; a voxel character later (ties to the asset pipeline). It reads ground height from the nav grid.
- Keep an optional "orbit/spectate" mode (today's behavior) for screenshots.

## Interaction layer (RPG-ness)

Start minimal, grow later:
- Props become interactables (`well`, `bench`, `lamp`) — proximity prompts.
- With doc 1's `lyrics`/`sections`, lay the song out **spatially**: each `section` is a district along a path, and lyric lines become landmarks/signposts you walk past in time order — "walk the song." `motionProfile`/`palette.mood` can tint district ambiance.
- NPCs/quests are a later LLM-driven layer (the `story` field is ready-made narrative fuel).

## Architecture

- **`libs/world-nav` (new, renderer-agnostic):** `buildNavGrid`, `findPath`, passability table. Pure logic, fully unit-testable (like `libs/wfc`). No `three`.
- **`apps/web` (controller):** input handling, follow camera, avatar mesh, movement interpolation — browser-specific, stays in the app.
- **Pairs with doc 2:** the nav grid is built per chunk and stitched; reaching a chunk edge triggers streaming the next chunk, and the path planner works across loaded chunks.

## What this touches in the codebase

- **New:** `libs/world-nav` (`buildNavGrid`, A*, passability) + tests.
- **`apps/web`:** new `PlayerController` (camera + avatar + input) replacing the orbit-only loop; keep orbit as a toggle.
- **`libs/world-core`:** optionally expose tile world positions / a height sampler so the avatar and nav grid agree with the rendered geometry (today `sampleHeight` is private to `build-scene`).
- **No change** to `libs/contracts` for v1 (the spec already has tiles + heights), unless we add explicit `walkable`/`spawn` hints later.

## Open questions

1. Click-to-move, WASD, or both?
2. First-person ever, or third-person/iso only?
3. Step threshold + do we require `stairs` for *all* elevation changes, or just steep ones?
4. Is "walk the song" (sections/lyrics as space) a v1 goal or a later layer?

## Recommendation

Ship a single-world MVP first: `libs/world-nav` (passability + A*) + a third-person follow `PlayerController` in `apps/web`, using `stairs` for elevation. Then integrate chunk streaming (doc 2) so walking expands the world, and finally the song-timeline layout (doc 1's `sections`/`lyrics`).
