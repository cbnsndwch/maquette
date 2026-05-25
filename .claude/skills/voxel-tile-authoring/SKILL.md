---
name: voxel-tile-authoring
description: Protocol for building and QA-ing voxel tiles (terrain, nature, props, and multi-cell buildings) via the maquette-world MCP tools, including per-asset footprint and resolution. Invoke at the start of any tile build session. Failure to follow the QA protocol will produce low-quality tiles.
---

# Voxel Tile Authoring Protocol

---

## Hard rules (never break these)

- **Author grid = `(w·r) × (d·r)` voxels**, where `[w, d]` is the tile's cell footprint (default `1×1`) and `r` is its resolution (default `12`). `create_tile` echoes the exact `x`/`y` ranges and the ground threshold back in its `conventions` — **trust that response; never hardcode 12 or 4.** Default tile (1×1 @ 12): x ∈ [0..11], y ∈ [0..11], z = up.
- **The bottom `groundLayers` voxel layers are underground**, where `groundLayers = 4 · (r/12)` (4 at r=12, 8 at r=24, 12 at r=36, 16 at r=48). The layer at `z = groundLayers` is the visual ground surface.
- **Per-category z rules — these differ, do not lump them together:**
  - `terrain` — fills the cell from z=0; the bottom `groundLayers` are the buried foundation, `z = groundLayers` is the surface a player sees.
  - `nature` / `props` — ground-anchored (they clip in at the column base): **every voxel must be at `z ≥ groundLayers`**, so the object sits *on* the surface instead of sunk into it. No exceptions.
  - `buildings` — rest on top of whatever terrain they're placed on (they advance the column base): **author from `z = 0`** — the bottom face is the foundation that meets the terrain surface. Do **not** add a buried offset, or the building will float.
- **Do not bake directional lighting into colors.** The renderer already shades faces by orientation (top=1.0×, right=0.82×, left=0.62×). Never paint one face darker to fake a shadow — give each material one flat *base* value and let the renderer light it.
- **Intentional color variation is encouraged — it is NOT the same as baked shadows.** Varying hue/value across voxels of the *same material* (alternating plank tones, tonal steps, weathering, speckle) is a stylistic device, not faked lighting. If the reference — or the set it belongs to — uses tonal variation to look hand-crafted or whimsical, you MUST reproduce it; a single flat color per material reads as sterile and off-style. Match the set's palette *behavior*, not just its hues.
- Max **255 unique colors** per tile.

---

## Tile size & resolution — decide BEFORE create_tile

Two independent levers let a tile be bigger or more detailed. Pick both up front
(they're set on `create_tile` and baked through `save_tile` automatically) — you
**cannot** change them after voxels exist without starting over.

### Footprint — `footprint: [w, d]` (cells, default `[1, 1]`)
Use a multi-cell footprint for an asset that is physically larger than one tile —
i.e. **buildings**. Each cell is 12 world units; a `[w, d]` tile is authored on a
`(w·12) × (d·12)` voxel grid and behaves as one atomic *building unit*.

Reference footprints for the building set:

| Building | footprint |
|---|---|
| bridge | `[2, 1]` |
| house / cube house / altar / tower chapel / windmill | `[2, 2]` |
| terrace house | `[3, 2]` |
| main chapel / pergola house | `[3, 3]` |
| main villa | `[4, 4]` |

Placement behavior an author must know (it shapes how the tile gets used):
- The building **anchors** at the placed `(gx, gy)` (its min corner) and reserves
  every covered cell. Rotation turns a `w×d` footprint into `d×w` at rot 1 / 3 —
  so a `[2,1]` bridge spans 2 cells east-west at rot 0, 2 cells north-south at rot 1.
- It must land fully in bounds, on cells **free of other buildings**, and on a
  **single level terrain surface**. Otherwise placement rejects with
  `out_of_bounds` / `occupied` / `not_level`.
- Erasing **any** covered cell removes the whole building.
- Don't squarify: design a `[3,2]` terrace to actually read as 3-wide × 2-deep.

### Resolution — `resolution: r` (default `12`; allowed `12 / 24 / 36 / 48`)
Use a higher `r` for an asset that needs **finer detail in the same physical
footprint** — ornate trim, small curves, lettering. A tile of resolution `r` packs
`r` cubes (each `12/r` world units wide) across the same cell, so the asset is the
same size, just crisper. Terrain stays at 12.

- Author grid becomes `(r·w) × (r·d)`; the buried `groundLayers` scale to `4·(r/12)`.
  Read the exact ranges from the `create_tile` response.
- **Axis cap:** `r·w ≤ 256` and `r·d ≤ 256` (a 4×4 villa caps at r=48 → 192; a 1×1
  prop can go to r=48 → 48). Going over rejects at save.
- Cost scales ~`(r/12)²` in voxels — only spend resolution where the detail reads.
  Most props are fine at 12.

The two combine freely: a `[2,2]` house at `r=24` is authored on a 48×48 grid.

---

## Phase 0 — Reference study (MANDATORY before creating a tile session)

**Load the reference image with the Read tool.** Study it carefully. Do not skip this step or rely on memory from earlier in the session — load it again every time.

Then write answers to all of the following before touching the MCP tools:

### 0-pre. Classify the reference — grid-true or concept image?

Before measuring anything, decide which kind of reference you have, because it changes the entire method below:

- **Grid-true voxel render** — clean, uniform cubes on a consistent grid (e.g. exported from a voxel editor). Cell counts map 1:1 to voxels, so you can measure literally.
- **Stylized / AI-generated concept image** — produced by a generic image model or hand-painted. The "voxels" are NOT uniform: cube sizes drift, edges don't align to a grid, and a literal cell count can imply dimensions far larger than the tile (e.g. "22 wide" for a 12×12 tile). For these you must **extract the *intent* — gestalt, proportion ratios, exact element counts, palette behavior — and reinterpret it down to fit the tile budget. Do NOT transcribe cell counts literally.**

State which type it is and carry that decision through 0b/0c. When in doubt, assume concept image and prioritize proportion over literal measurement.

**The reference image is the single source of truth for visual facts.** If any handed-down spec — a task instruction, a "fact" from a prior iteration, a memory — contradicts what you see in the reference, the reference wins. Note the contradiction explicitly, then follow the image.

### 0a. Structural inventory
List every distinct component visible in the reference. For each:
- **Name** (e.g. "front leg", "seat slat", "backrest top rail", "post cap")
- **Color** (describe the hue and approximate hex)
- **Position** relative to the whole object (front/back/left/right, low/mid/high)
- **Visual weight**: does this element dominate the image or is it secondary?

### 0b. Measure the reference — ratios and exact counts
Read the isometric faces for two different things and keep them separate:

**Ratios (always meaningful, even for concept images):**
- Width : depth : height of the whole object.
- Each major element's size as a fraction of the whole.
- Gap width between repeated elements as a fraction of the element width.

**Exact counts (discrete repeated elements only — slats, rails, pickets, balusters):**
- Count them exactly. This is a hard constraint, not an approximation — three slats and four slats read as different objects. Recount if unsure. Do **not** inherit the count from a spec or prior build without confirming it against the image (see 0-pre).

**Orientation / run-direction (just as important as the count):**
- For every linear element, determine **which axis it runs along, read off the image** — never inherited from a handed-down spec. E.g. a bench seat's planks run the **long** axis, **parallel to the backrest rails** — not front-to-back. Note which elements are parallel vs perpendicular to each other; getting this 90° wrong produces the wrong object even with the right counts and colors.

**Mapping counts to voxels depends on 0-pre:**
- *Grid-true render:* a count of N cells ≈ N voxels; size shapes directly.
- *Concept image:* cell counts are unreliable for absolute size. Take the *ratios* and the *exact repeated-element counts*, then scale the whole object to fit the 12×12 footprint (see 0c). A reference that measures "22 wide" becomes ~11 wide in the tile while preserving its width:depth:height ratio and its slat count.

### 0c. Proportions and footprint budget
Express ratios relative to the total visible object:
- What fraction is below the primary surface (seat/top)? What fraction is the upper structure?
- Is the object wider, deeper, or taller? State the **dominant aspect ratio** (e.g. "≈2:1 wider than deep, low backrest").

**Then allocate the author grid to preserve that ratio.** First confirm the grid you chose at create_tile: a single-cell prop is `12×12×H`; a building is `(w·12) × (d·12) × H`; a high-res asset is `(r·w) × (r·d) × H`. Derive the dominant ratio, scale the whole object to fit, and write down the target footprint (e.g. "11 wide × 6 deep" for a 2:1 bench on a 12×12 grid) *before* designing any shape. The grid is a fixed budget — never let it silently squarify a wide object or stretch a compact one. If a prop's reference is wider than its single cell, the whole object scales down together (you do not crop or square it off) — **unless** it is genuinely a multi-tile building, in which case give it the right `[w, d]` footprint instead of cramming it into one cell.

A wide, low object built square reads as the wrong object class (a bench becomes a chair). Carry the target footprint into Phase 1 and verify the built silhouette against it in QA.

### 0d. Color roles
For each distinct color in the reference: what structural role does it play?
Example: "Blue = every horizontal surface the user touches (slats, rails). Brown = every vertical structural member (legs, posts, caps)."
These roles must be respected exactly. Do not mix colors into wrong roles.

Also capture **within-material variation**: does a single material use multiple tones (alternating planks, tonal steps, speckle, weathering)? List the tones and where they fall — reproducing this is what makes the tile look hand-crafted and on-style (see the color rule in Hard rules). If other tiles in the same set exist, glance at them and match the set's shared palette *behavior*, not just this object's hues.

### 0e. Negative space
Where are the gaps, holes, and open areas? List them explicitly.
Example: "1-cell gap between each seat slat. 2-cell gap between the two backrest rails. Both sides of the bench are completely open — no side rails or armrests."
Missing negative space is the most common quality failure. If the reference has gaps, your build must have matching gaps.

### 0f. Dominant visual hierarchy
Which element draws the eye first? Which is second, third?
Your build must preserve this hierarchy. The most visually prominent element must occupy the most voxels / boldest color in your design.

---

## Phase 1 — Design on paper (MANDATORY before calling create_tile)

Write out every `add_shape` call you plan to make:

```
Element: front-left leg
  shape=box, x=1, y=1, z=4, w=2, d=2, h=3, color=#8B5E3C
  z-check: z=4 ✓ (= groundLayers, sits on the surface)
```

For every shape, explicitly check its base z against the **z rule for this tile's
category** (use the `groundLayers` value `create_tile` returned, which scales with
resolution):
- `nature` / `props`: every voxel `z ≥ groundLayers` (4 at r=12).
- `buildings`: author from `z = 0` (the foundation rests on terrain — no offset).
- `terrain`: fill from `z = 0`, including the buried base.

Verify your design against Phase 0:
- Does the overall footprint match the target you set in 0c (right aspect ratio — not squarified)?
- Are the exact repeated-element counts from 0b correct (e.g. 3 slats, not 4)?
- Does each element have the right color role, including any within-material tonal variation from 0d?
- Do the h values match your voxel cell counts from 0b?
- Are all gaps from 0e represented as actual empty space (no shapes filling them)?
- Does the dominant element from 0f have enough voxels/size to dominate?
- Are slender members actually slender? Thin posts/legs/rails in the reference stay thin (often 1 voxel) even if it feels fragile — do not fatten them to 2×2 by default.
- Does the design capture characteristic stylistic gestures (a backrest lean, a taper, alternating tones) rather than a generic boxy stand-in?

If your design doesn't satisfy Phase 0, revise it before building. Do not "fix it in QA."

---

## Phase 2 — Build incrementally

1. Call `create_tile` with the correct `category`, `stackable`, and — when the asset needs them — `footprint` (e.g. `[3, 2]`) and `resolution` (e.g. `24`). **Read its response**: it reports the exact `x`/`y` ranges and `groundLayers` you must build within. Don't assume 12×12×4.
2. Add the **primary skeleton** first: legs, posts, main frame. Stop.
3. Call `render_tile` with `resolution=1024` (gives 512px panels, 1024px composite).
4. Verify the skeleton silhouette and proportions are correct before adding surface detail.
5. Add secondary elements: slats, rails, caps, trim.
6. Call `render_tile` again.
7. QA (Phase 3) before saving.

Do not add every shape and render once at the end. Catch errors early.

---

## Phase 3 — Visual QA (MANDATORY after every render_tile)

**Always use `resolution=1024`** for QA renders.

After calling `render_tile`, immediately call **`Read` on the reference image**. You now have both images in your visual context at the same time. Do not proceed until you have done the full comparison below.

The 2×2 composite layout is:
```
┌──────────┬──────────┐
│  NE view │  NW view │   top-left shows front+right face
│ (primary)│ (side)   │   top-right shows front+left face
├──────────┼──────────┤
│  SW view │  SE view │   bottom-left shows back+right face
│  (back)  │ (side)   │   bottom-right shows back+left face
└──────────┴──────────┘
```

### 3a-0. Gestalt gate (do this FIRST, before any element check)
Before drilling into individual components, compare the whole object against the reference:
- **Silhouette & aspect ratio:** does the overall shape match? Compare the build's width:depth:height against the target from 0c. A square build of a wide reference fails here even if every part is individually correct.
- **Object class:** would a stranger name the build the same thing as the reference (a "wide park bench", not a "chair")?
- **Repeated-element count:** does the number of slats / rails / pickets match 0b exactly?
- **Orientation:** do linear elements run along the correct axis (e.g. seat planks parallel to the backrest, not rotated 90°)?
- **Palette behavior:** flat single tone where the reference has hand-crafted variation? That is a failure, not a nicety.

Write a verdict. **If the gestalt gate fails, the per-element PASSes below do not matter — fix the gestalt first.** Element-by-element QA can pass every line item while the object as a whole is wrong; this gate exists to catch exactly that.

### 3a. NE panel — primary view
This is the angle closest to the reference image. Use it for the main comparison.

For each component in your Phase 0 structural inventory, state:
- Is it **present** and **visible** from this angle?
- Does its **height** match the reference cell count?
- Does its **width** look right?
- Does its **color** match the intended role?
- Is **negative space** (gaps) visible and correctly sized?

Write a verdict: **PASS** or **FAIL [description of mismatch]**.

### 3b. NW and SE panels — side profiles
These reveal depth (y-axis), which you cannot judge from NE alone.

- Is the object actually **3D**, or does it look like a flat slab?
- Does depth match the reference? (If the reference shows slats as thick boards, the side view must show corresponding depth.)
- Are any unexpected voxels visible that shouldn't be there from this angle?

Write a verdict for each.

### 3c. SW panel — back face
- Does the back match the reference back?
- Are any structural elements missing on the back face?
- No floating voxels or underground stumps visible?

Write a verdict.

### 3d. Ground anchor check
Look at the bottom edge of any panel where the object meets the background. There must be **no voxels below the lowest visible structural element** for props/nature. If you see a stump or root block at the bottom, you have underground voxels at z < 4.

Write: **CLEAN** or **FAIL — underground voxels present**.

### 3e. Issues list
After all panel verdicts, write a numbered list of every failure, ordered by visual impact (most impactful first). Be specific:

```
1. FAIL (NE, high impact): Seat slats are h=1 hairlines; reference shows h≥2 thick boards. Fix: change all seat slat shapes to h=2.
2. FAIL (NW, medium): Object has no visible depth — slats are d=1. Reference shows slats are approximately d=2. Fix: increase d to 2.
3. PASS: Colors correct.
4. PASS: Proportions approximately correct.
5. PASS: Ground anchor clean.
```

---

## Phase 4 — Fix and iterate

Fix **only the highest-impact issue** from the issues list. Add the corrective shape (later shapes overwrite earlier ones at the same position). Re-render with `resolution=1024`. Re-run Phase 3. Repeat until the issues list is empty of structural problems.

Do not fix multiple issues in one pass if you are unsure of the interaction. One issue at a time until you have confidence.

---

## Phase 5 — Save

Call `save_tile` only when Phase 3 produces all PASSes (or only renderer/lighting issues remain that post-processing will handle).

---

## Mykonos palette reference

| Role | Color | Hex |
|------|-------|-----|
| Cobalt blue — benches, railings, seat surfaces | vivid blue | `#2060C8` |
| Dark structural wood | dark brown | `#8B5E3C` |
| Terracotta | warm orange-red | `#C05020` |
| Whitewash | off-white | `#F0EEE8` |
| Sandy stone | tan | `#C8A068` |
| Medium stone | warm grey | `#9A9080` |
| Dark stone | dark grey-brown | `#6A6058` |
| Grass | green | `#5E8A30` |
| Water | blue | `#3878B4` |

---

## Common failure modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Object reads as a chair, not a bench | Side armrests present | Remove all horizontal side-beam shapes |
| Slats look like a solid surface | h=1 slats merge in rendering | Increase slat h to 2; verify 1-voxel gaps between y-positions |
| Object looks flat / no depth | d=1 on all shapes | Increase d to 2 for surfaces that should have thickness |
| Underground stump below prop | Shapes at z < 4 | Remove or shift to z ≥ 4 |
| Wrong color in wrong role | Color/material role confusion | Re-read 0d; structural verticals are always brown, horizontal surfaces always the accent color |
| Backrest looks like a striped wall | Back-post voxels showing through | Ensure back rails span the full width including post positions; posts are still brown behind them |
| Post caps look giant | Cap w/d larger than post | Cap must match or be smaller than post cross-section (2×2 at most for a 2×2 post) |
| Build is square but reference is wide/low | Footprint squarified; aspect ratio never budgeted | Set a target footprint from the 0c ratio; scale the whole object down to fit, preserving width:depth:height |
| Tile looks sterile / off-style vs the set | One flat color per material; missing intra-material tonal variation | Reproduce the reference's alternating tones / weathering — vary *value* within a material (not baked shadows) |
| Wrong number of slats / rails | Count inherited from a spec or prior build, not the image | Count repeated elements on the reference exactly; the reference overrides handed-down specs |
| Dimensions blown out / won't fit the tile | An AI/concept reference measured literally (cells aren't uniform) | Classify the reference (0-pre); for concept images use ratios + exact counts and reinterpret to the 12×12 budget |
| Posts / legs look chunky | Slender members fattened to 2×2 by default | Keep thin members thin (often 1 voxel) to match the reference's visual weight |
| Seat planks / slats run the wrong way | Run-direction inherited from a spec, not read off the image | Derive orientation from the reference; a bench seat's planks run the long axis, parallel to the backrest rails |
| Building floats above the terrain | Authored with a buried offset (`z ≥ groundLayers`) like a prop | Buildings advance the column base — author from `z = 0`; the bottom face is the foundation |
| Building voxels rejected as out-of-footprint | Built past the `(w·12)` / `(d·12)` grid, or assumed a square footprint | Re-read the `create_tile` ranges; design to the real `[w, d]` (a `[3,2]` is 36 wide × 24 deep, not square) |
| High-res tile won't save (axis cap) | `r·w` or `r·d` exceeded 256 | Lower the resolution or footprint so each axis ≤ 256 |
| Detail looks no crisper despite r=24 | Resolution bumped but shapes still authored at 12-grid coordinates | Scale element sizes/positions up by `r/12`; spend the extra cubes on the detail that reads |
