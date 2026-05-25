// One-off authoring script: bakes a 3×3, r=24 "pergola house" demo tile to
// exercise the in-tile resolution multiplier (finer cubes in the same world
// cell) and verify ground-datum alignment next to r=12 terrain. Mirrors the
// editor/MCP save path (encodeVox + catalog upsert).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { box, shell, mergeVoxels, encodeVox } from '@cbnsndwch/world-core';

const R = 24; // voxels per cell edge (24 → 0.5 world-unit cubes)
const CELLS = 3;
const N = R * CELLS; // 72 author voxels per axis
const GROUND = 4 * (R / 12); // buried-layer count at r=24 → datum sits at z=8

// Cycladic palette.
const WHITE = '#f3efe6';
const CREAM = '#e7dcc4';
const BLUE = '#2f6fb0';
const DOOR = '#1b5ba8';
const PINK = '#d6457f';
const GREEN = '#6a9b54';
const STONE = '#cbb89a';

const Z0 = GROUND; // structure base = the ground datum (like the_block @ r=12)

const parts = [];

// Raised terrace platform across the whole footprint — its top face is the
// datum, so the build clearly "meets the ground" next to r=12 terrain.
parts.push(box(0, 0, Z0, N, N, 2, CREAM));

// House body: a white cube in the back-right ~2×2 area, hollow walls + roof.
const hx = 22, hy = 22, hw = 48, hd = 48, hh = 38;
parts.push(shell(hx, hy, Z0 + 2, hw, hd, hh, WHITE, { sides: true, roof: true }));
// Solid corners/quoins so it doesn't read as paper-thin.
parts.push(shell(hx, hy, Z0 + 2, hw, hd, hh, WHITE, { sides: true }));

// Roof clerestory box.
parts.push(box(hx + 14, hy + 14, Z0 + 2 + hh, 20, 20, 10, WHITE));

// Blue door centered on the front (−y) wall.
parts.push(box(hx + 18, hy - 1, Z0 + 2, 12, 3, 22, DOOR));
// Two blue shuttered windows on the front wall.
parts.push(box(hx + 4, hy - 1, Z0 + 18, 8, 2, 12, BLUE));
parts.push(box(hx + 36, hy - 1, Z0 + 18, 8, 2, 12, BLUE));

// Pergola over the front-left courtyard (x 0..40, y 0..36).
const PX0 = 2, PY0 = 2, PX1 = 38, PY1 = 34, PTOP = Z0 + 2 + 32;
for (const [cx, cy] of [[PX0, PY0], [PX0, PY1], [PX1, PY0], [PX1, PY1]]) {
    parts.push(box(cx, cy, Z0 + 2, 4, 4, 32, BLUE)); // columns
}
// Slatted beams across the top (every 6 voxels in x).
for (let x = PX0; x <= PX1; x += 6) {
    parts.push(box(x, PY0, PTOP, 3, PY1 - PY0 + 4, 3, BLUE));
}
parts.push(box(PX0, PY0, PTOP + 3, PX1 - PX0 + 4, 4, 3, BLUE)); // edge rail
// Pink bougainvillea draped over the pergola.
for (let x = PX0; x <= PX1 + 4; x += 4) {
    parts.push(box(x, PY0 - 1, PTOP + 5, 3, 3, 4, PINK));
    parts.push(box(x, PY1 + 2, PTOP + 5, 3, 2, 3, PINK));
}

// A couple of potted plants in the courtyard.
parts.push(box(10, 16, Z0 + 2, 5, 5, 4, STONE));
parts.push(box(10, 16, Z0 + 6, 5, 5, 5, GREEN));
parts.push(box(24, 10, Z0 + 2, 5, 5, 4, STONE));
parts.push(box(24, 10, Z0 + 6, 5, 5, 6, GREEN));
parts.push(box(25, 11, Z0 + 12, 3, 3, 3, PINK));

const voxels = mergeVoxels(...parts).filter(
    v => v.x >= 0 && v.x < N && v.y >= 0 && v.y < N && v.z >= 0
);

let maxZ = 0;
for (const v of voxels) if (v.z > maxZ) maxZ = v.z;
const dims = [N, N, maxZ + 1];
console.log('voxels', voxels.length, 'dims', dims);

const publicDir = path.resolve('apps/three-scene/public');
const voxPath = path.join(publicDir, 'voxels/terrain/pergola_house.vox');
await writeFile(voxPath, Buffer.from(encodeVox(voxels, dims)));

const catalogPath = path.join(publicDir, 'voxels/catalog.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const def = {
    id: 'pergola_house',
    name: 'Pergola House',
    category: 'buildings',
    file: '/voxels/terrain/pergola_house.vox',
    stackable: false,
    footprint: [CELLS, CELLS],
    resolution: R
};
const i = catalog.tiles.findIndex(t => t.id === def.id);
if (i >= 0) catalog.tiles[i] = def;
else catalog.tiles.push(def);
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 4)}\n`);
console.log('wrote', voxPath, 'and catalog entry');
