---
name: mykonos-match
description: Incrementally improve one mykonos voxel object (prop/building/tile surface) to match its original reference asset. Invoke as `/mykonos-match <object> [category]`, e.g. `/mykonos-match cypress prop`. Captures our inspector render, diffs it against the reference PNG, makes one focused edit, rebuilds, and re-screenshots.
argument-hint: "[object] [category: prop|building|surface]"
arguments: [object, category]
disable-model-invocation: true
allowed-tools: Read, Edit, Glob, Grep, Bash
---

Improve the mykonos object **`$object`** (category **`$category`**, default `prop` if blank) to better match its original reference asset. Do exactly this, then STOP and wait for me:

## 0. Resolve params
- `OBJECT = $object`
- `CATEGORY = $category` (if blank, use `prop`)
- Map CATEGORY → inspector `cat` param and which recipe to read:
  - `prop` → `cat=props`, recipe = the `*Prop` fn (e.g. `cypressProp`)
  - `building` → `cat=structures`, recipe = the building fn (e.g. `chapel`, `twoStory`)
  - `surface` → `cat=surfaces`, recipe = `mykonosSurface` (the `case` for this tile id)

## 1. Capture OUR current render and Read it
```
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
"$CHROME" --headless=new --enable-unsafe-swiftshader --use-angle=swiftshader \
  --ignore-gpu-blocklist --hide-scrollbars --window-size=1280,900 \
  --virtual-time-budget=5000 \
  --screenshot="D:/CBN/PROJECTS/MUSICOLOGIA/REPOS/maquette/.local/shots/cmp-before.png" \
  "http://localhost:8301/inspect.html?biome=mykonos&cat=<CAT>&obj=$object"
```
(If the dev server isn't up, start it: `pnpm --filter web dev` in the background.)

## 2. Read the matching reference asset PNG
`.local/repos/mykonos-voxels/assets/<file>.png` — glob the dir if the name isn't obvious. Map:
olive-tree→olive, cypress→cypress, bougainvillea→bougainvillea, pot→terracotta_pot,
lamp→lantern_post, well→well, bench→bench, agave→agave, windmill→windmill;
cube-house→cube_house, two-story→two_story, chapel→main_chapel, villa→villa;
grass→grass, sand→sand, rock→stone, path→path, water→water, stairs→stairs, wall→low_wall.
Reference proportions live in `.local/repos/mykonos-voxels/src/assets/assetDefinitions.js`; the canonical 45-color palette in `src/config.js`.

## 3. Diff
List the top 3–6 concrete differences, ranked by visual impact:
silhouette/proportion · exact palette colors · structural detail · missing/extra elements.

## 4. One focused edit
Edit JUST this object's recipe in `libs/world-core/src/biome-render.mts` (palette = the `MP` object; add exact `config.js` hexes to `MP` if a color is missing). Do NOT touch other objects or regress the main scene. Keep the change incremental.

## 5. Rebuild + verify
`pnpm --filter @cbnsndwch/world-core build`, confirm `pnpm --filter @cbnsndwch/world-core typecheck` and `lint` are clean, then re-capture (`--screenshot=...cmp-after.png`) and show before → after.

## 6. Verdict
End with one line: close enough, or worth another round?

I'll reply **"again"** to iterate on the same object, or give the next OBJECT/CATEGORY.
