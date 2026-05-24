import * as THREE from 'three';

import {
    box,
    compose,
    cylinder,
    dome,
    mergeVoxels,
    shell,
    type Voxel
} from './voxel.mjs';

/**
 * Per-biome rendering: how a biome's tile ids map to palette slots, and how its
 * prop ids become meshes. This is the *view* half of a biome (the *generation*
 * half lives in `@cbnsndwch/world-gen`), kept here so the renderer owns all the
 * `three` code. `buildScene` dispatches on `WorldSpec.biome` through this registry.
 */

export interface BiomeRenderer {
    /** Palette slot index that colors a given tile id. */
    tilePaletteIndex(tileId: string): number;
    /** Build a prop mesh for a biome-local prop id. */
    buildProp(propId: string, palette: THREE.Color[]): THREE.Object3D;
    /**
     * Optional rich voxel detailing. When present, `buildScene` overlays a
     * sub-tile patterned surface and multi-voxel props instead of the plain
     * box-per-tile + simple-mesh path. Biomes without it render as before.
     */
    voxels?: BiomeVoxels;
}

export interface BiomeVoxels {
    /** Sub-tile resolution: voxels per tile edge (e.g. 4). */
    perTile: number;
    /**
     * Voxels for one tile's top surface, in local coords (0..perTile, z up).
     * The grid cell (gx,gy) is passed so patterns can vary deterministically.
     */
    surface(tileId: string, gx: number, gy: number): Voxel[];
    /** Voxels for a prop, in local coords (footprint perTile wide, z up). */
    prop(propId: string): Voxel[];
    /**
     * Voxels for a multi-cell composite building, spanning footprint*perTile per
     * side in local coords. Optional: biomes without it place no buildings.
     */
    structure?(type: string): Voxel[];
    /** Object ids by category, for the standalone inspector page. */
    catalog?: {
        surfaces: readonly string[];
        props: readonly string[];
        structures: readonly string[];
    };
}

function standard(
    color: THREE.Color,
    emissive = 0
): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color,
        flatShading: true,
        emissive: new THREE.Color(emissive),
        emissiveIntensity: emissive ? 1 : 0
    });
}

// ---------------------------------------------------------------------------
// Mykonos
// ---------------------------------------------------------------------------

const MYKONOS_TILE_SLOT: Record<string, number> = {
    water: 6,
    sand: 5,
    grass: 3,
    rock: 4,
    plaza: 0,
    path: 4,
    wall: 0,
    rooftop: 2,
    dome: 1,
    stairs: 0
};

function mykonosProp(propId: string, palette: THREE.Color[]): THREE.Object3D {
    const group = new THREE.Group();
    const olive = new THREE.Color('#6b7a3a');
    const trunk = new THREE.Color('#7a5a3a');
    const stone = palette[4] ?? new THREE.Color('#cdbfa3');
    const terracotta = palette[2] ?? new THREE.Color('#c66b3d');

    switch (propId) {
        case 'olive-tree': {
            const t = new THREE.Mesh(
                new THREE.CylinderGeometry(0.06, 0.08, 0.5, 6),
                standard(trunk)
            );
            t.position.y = 0.25;
            const leaves = new THREE.Mesh(
                new THREE.IcosahedronGeometry(0.32, 0),
                standard(olive)
            );
            leaves.position.y = 0.6;
            group.add(t, leaves);
            break;
        }
        case 'cypress': {
            const body = new THREE.Mesh(
                new THREE.ConeGeometry(0.18, 1.1, 7),
                standard(new THREE.Color('#3f5a2e'))
            );
            body.position.y = 0.55;
            group.add(body);
            break;
        }
        case 'lamp': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6),
                standard(stone)
            );
            post.position.y = 0.35;
            const bulb = new THREE.Mesh(
                new THREE.SphereGeometry(0.08, 8, 8),
                standard(new THREE.Color('#fff3c4'), 0xffcc66)
            );
            bulb.position.y = 0.75;
            group.add(post, bulb);
            break;
        }
        case 'pot': {
            const body = new THREE.Mesh(
                new THREE.CylinderGeometry(0.12, 0.08, 0.22, 8),
                standard(terracotta)
            );
            body.position.y = 0.11;
            const plant = new THREE.Mesh(
                new THREE.IcosahedronGeometry(0.14, 0),
                standard(olive)
            );
            plant.position.y = 0.3;
            group.add(body, plant);
            break;
        }
        case 'well': {
            const ring = new THREE.Mesh(
                new THREE.CylinderGeometry(0.22, 0.24, 0.3, 10),
                standard(stone)
            );
            ring.position.y = 0.15;
            group.add(ring);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(stone)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    return group;
}

// Sun-bleached Cycladic palette (ported from the mykonos-voxels reference).
const MP = {
    white: '#fafaf5',
    whiteShadow: '#e6e2d3',
    whiteDeep: '#cfc9b7',
    cobalt: '#1b5ba8',
    cobaltLight: '#2e6fbc',
    cobaltDeep: '#134680',
    grass: '#7eaa5f',
    grassDark: '#5c8a44',
    grassLight: '#9bc377',
    sand: '#e8d4a8',
    sandDark: '#c9b084',
    sandLight: '#f1e1bd',
    path: '#d9cdb6',
    pathDark: '#c2b59c',
    pathLight: '#e8ddc8',
    sea: '#6ec8e0',
    seaDeep: '#4da8c4',
    seaShine: '#a8e0ee',
    stone: '#c9c3b5',
    stoneDark: '#a8a292',
    stoneLight: '#ddd8ca',
    cypress: '#3d7355',
    cypressDark: '#28533a',
    cypressLight: '#5a8d6e',
    olive: '#7a9460',
    oliveDark: '#5a7448',
    oliveLight: '#9bb37e',
    trunk: '#7a5a3a',
    trunkDark: '#5a3f25',
    terracotta: '#c4622e',
    terraLight: '#dc7d44',
    terraDark: '#9a4720',
    bougain: '#d85b8e',
    bougainLight: '#ee84ad',
    bougainDark: '#b03a6a',
    leaf: '#4a7a3e',
    leafDark: '#2f5527',
    agave: '#a4b87a',
    agaveDark: '#7a8e54',
    flower: '#e16ea6',
    flowerWhite: '#fff8e6',
    flowerYellow: '#f4d168',
    soil: '#7a5a3c',
    iron: '#3a3833',
    ironLight: '#5a5750',
    flame: '#ffc24a'
} as const;

// Real assets are ~12 voxels per tile edge (see assets/sand.png), not 4.
const VPT = 12;
const MID = VPT / 2;

/** A 1-voxel-thick tile floor with optional per-voxel accent coloring. */
function mFloor(
    color: string,
    accents?: (ix: number, iy: number) => string | undefined
): Voxel[] {
    const out: Voxel[] = [];
    for (let ix = 0; ix < VPT; ix++) {
        for (let iy = 0; iy < VPT; iy++) {
            out.push({ x: ix, y: iy, z: 0, c: accents?.(ix, iy) ?? color });
        }
    }
    return out;
}

/**
 * Tile surfaces. Flat ground scatters a few shades per voxel so the chunky
 * grain reads under flat lighting; built tiles (wall/dome/rooftop) get vertical
 * structure. (Composite buildings supersede the built tiles in a later pass.)
 */
function mykonosSurface(tileId: string, gx: number, gy: number): Voxel[] {
    const hash = (ix: number, iy: number) =>
        (ix * 7 + iy * 13 + gx * 5 + gy * 11) % 7;

    switch (tileId) {
        case 'water':
            return mFloor(MP.sea, (ix, iy) => {
                if ((ix + iy * 2 + gx) % 5 === 0) return MP.seaShine;
                const k = hash(ix, iy);
                return k === 0 || k === 3 ? MP.seaDeep : undefined;
            });
        case 'sand':
            return mFloor(MP.sand, (ix, iy) => {
                const k = hash(ix, iy);
                return k === 0
                    ? MP.sandDark
                    : k === 2
                      ? MP.sandLight
                      : undefined;
            });
        case 'grass':
            return mFloor(MP.grass, (ix, iy) => {
                const k = hash(ix, iy);
                return k === 0
                    ? MP.grassDark
                    : k === 1
                      ? MP.grassLight
                      : undefined;
            });
        case 'rock':
            return mFloor(MP.stone, (ix, iy) => {
                const k = hash(ix, iy);
                return k === 0
                    ? MP.stoneDark
                    : k === 2
                      ? MP.stoneLight
                      : undefined;
            });
        case 'path':
            return mFloor(MP.path, (ix, iy) => {
                const band = Math.floor(iy / 3);
                const off = (band % 2) * 2;
                if (iy % 3 === 0 || (ix + off) % 4 === 0) return MP.pathDark;
                return hash(ix, iy) === 0 ? MP.pathLight : undefined;
            });
        case 'plaza':
            return mFloor(MP.white, (ix, iy) => {
                const k = hash(ix, iy);
                return k === 0
                    ? MP.whiteShadow
                    : k === 3
                      ? MP.whiteDeep
                      : undefined;
            });
        case 'wall':
            // Flat whitewashed roof with a low parapet — courtyard wall / roof.
            return compose(
                box(0, 0, 0, VPT, VPT, 1, MP.whiteShadow),
                shell(0, 0, 1, VPT, VPT, 1, MP.white)
            );
        case 'rooftop':
            return compose(
                box(0, 0, 0, VPT, VPT, 1, MP.whiteShadow),
                shell(0, 0, 1, VPT, VPT, 1, MP.white),
                box(0, 0, 1, VPT, 1, 1, MP.cobalt)
            );
        case 'dome':
            return compose(
                box(0, 0, 0, VPT, VPT, 1, MP.white),
                cylinder(MID, MID, 1, 4, 1, MP.white),
                dome(MID, MID, 2, 4, MP.cobalt),
                box(MID, MID, 7, 1, 1, 2, MP.white)
            );
        case 'stairs': {
            const out = box(0, 0, 0, VPT, VPT, 1, MP.white);
            for (let s = 0; s < 4; s++) {
                out.push(
                    ...box(
                        0,
                        s * 3,
                        1 + s,
                        VPT,
                        3,
                        1,
                        s % 2 ? MP.whiteShadow : MP.white
                    )
                );
            }
            return out;
        }
        default:
            return mFloor(MP.white, (ix, iy) =>
                hash(ix, iy) === 0 ? MP.whiteShadow : undefined
            );
    }
}

/** One slim conical cypress, tapering from radius ~2 at base to a point. */
function cypressTree(cx: number, cy: number, h: number): Voxel[] {
    const out: Voxel[] = box(cx - 1, cy - 1, 0, 2, 2, 3, MP.trunk);
    for (let z = 2; z < h; z++) {
        const r = Math.max(
            0,
            Math.round(2.2 * (1 - ((z - 2) / (h - 2)) * 0.7))
        );
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (dx * dx + dy * dy > r * r + 0.5) continue;
                const n = (dx + dy + z) % 3;
                const c =
                    n === 0
                        ? MP.cypressDark
                        : (dx * 7 + dy * 13 + z) % 5 === 0
                          ? MP.cypressLight
                          : MP.cypress;
                out.push({ x: cx + dx, y: cy + dy, z, c });
            }
        }
    }
    return out;
}

function cypressProp(): Voxel[] {
    return mergeVoxels(cypressTree(5, 6, 16), cypressTree(8, 5, 12));
}

function oliveProp(): Voxel[] {
    // Stepped stone plinth (matches reference: wide bottom, raised center)
    const base = mergeVoxels(
        box(1, 1, 0, 10, 10, 1, MP.stoneLight),
        box(2, 2, 1, 8, 8, 1, MP.stone)
    );

    // Trunk: wide dark base tapering to a narrow shaft
    const trunk = mergeVoxels(
        box(MID - 2, MID - 2, 2, 4, 4, 1, MP.trunkDark),
        box(MID - 1, MID - 1, 3, 2, 2, 2, MP.trunk)
    );

    // Oblate ellipsoid canopy: wide (rx=5) and flat (rz=3) like the reference
    const canopyVoxels: Voxel[] = [];
    const rx = 5,
        rz = 3;
    for (let iz = 0; iz <= rz; iz++) {
        const lr = rx * Math.sqrt(Math.max(0, 1 - (iz / rz) ** 2));
        const lrCeil = Math.round(lr);
        for (let ix = -lrCeil; ix <= lrCeil; ix++) {
            for (let iy = -lrCeil; iy <= lrCeil; iy++) {
                if (Math.sqrt(ix * ix + iy * iy) <= lr + 0.5) {
                    const k = (ix * 3 + iy * 5 + iz * 7) % 4;
                    const c =
                        k === 0
                            ? MP.oliveDark
                            : k === 1
                              ? MP.oliveLight
                              : MP.olive;
                    canopyVoxels.push({
                        x: MID + ix,
                        y: MID + iy,
                        z: 5 + iz,
                        c
                    });
                }
            }
        }
    }

    return mergeVoxels(base, trunk, canopyVoxels);
}

function bougainvilleaProp(): Voxel[] {
    const canopy = dome(MID, MID, 7, 4, MP.bougain);
    for (const v of canopy) {
        const k = (v.x * 5 + v.y * 7 + v.z * 3) % 5;
        if (k === 0) v.c = MP.bougainDark;
        else if (k === 1) v.c = MP.bougainLight;
        else if (k === 2) v.c = MP.leafDark;
    }
    return mergeVoxels(
        box(4, 4, 0, 4, 4, 2, MP.terracotta),
        box(4, 4, 2, 4, 4, 1, MP.terraDark),
        box(5, 5, 3, 2, 2, 5, MP.trunkDark),
        canopy
    );
}

function potProp(): Voxel[] {
    return compose(
        box(4, 4, 0, 4, 4, 2, MP.terracotta),
        box(4, 4, 2, 4, 4, 1, MP.terraDark),
        box(4, 4, 3, 4, 4, 2, MP.leaf),
        box(5, 5, 5, 2, 2, 1, MP.bougain),
        [
            { x: 4, y: 5, z: 5, c: MP.flowerWhite },
            { x: 7, y: 6, z: 5, c: MP.flowerYellow },
            { x: 6, y: 4, z: 6, c: MP.bougainLight }
        ]
    );
}

function lanternProp(): Voxel[] {
    return mergeVoxels(
        box(5, 5, 0, 2, 2, 8, MP.iron),
        shell(4, 4, 8, 4, 4, 3, MP.ironLight),
        box(5, 5, 9, 2, 2, 1, MP.flame),
        box(4, 4, 11, 4, 4, 1, MP.iron)
    );
}

function agaveProp(): Voxel[] {
    const out: Voxel[] = [];
    const cx = MID;
    const cy = MID;
    for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        for (let s = 0; s <= 4; s++) {
            const dx = Math.round(Math.cos(a) * s);
            const dy = Math.round(Math.sin(a) * s);
            out.push({
                x: cx + dx,
                y: cy + dy,
                z: Math.floor(s / 2),
                c: s >= 4 ? MP.agaveDark : MP.agave
            });
        }
    }
    return mergeVoxels(out);
}

function wellProp(): Voxel[] {
    return compose(
        cylinder(MID, MID, 0, 4, 3, MP.stone),
        cylinder(MID, MID, 1, 2, 2, MP.seaDeep),
        box(4, 4, 3, 1, 1, 5, MP.trunk),
        box(7, 7, 3, 1, 1, 5, MP.trunk),
        box(4, 4, 8, 4, 4, 1, MP.trunkDark)
    );
}

function benchProp(): Voxel[] {
    return compose(
        box(3, 5, 0, 6, 2, 1, MP.stone),
        box(3, 5, 1, 6, 2, 1, MP.trunk),
        box(3, 5, 2, 1, 2, 1, MP.trunk),
        box(8, 5, 2, 1, 2, 1, MP.trunk),
        box(3, 6, 3, 6, 1, 1, MP.trunk)
    );
}

function windmillProp(): Voxel[] {
    const out = compose(
        cylinder(MID, MID, 0, 3, 9, MP.white),
        cylinder(MID, MID, 9, 3, 1, MP.whiteShadow)
    );
    // Conical thatched roof.
    for (let iz = 0; iz < 4; iz++) {
        out.push(
            ...cylinder(
                MID,
                MID,
                10 + iz,
                Math.max(0, 3 - iz),
                1,
                iz >= 3 ? MP.terraDark : MP.terracotta
            )
        );
    }
    // Four blades on the front face.
    const by = 2;
    out.push({ x: MID, y: by, z: 7, c: MP.iron });
    for (let i = 1; i <= 4; i++) {
        out.push({ x: MID + i, y: by, z: 7, c: MP.trunk });
        out.push({ x: MID - i, y: by, z: 7, c: MP.trunk });
        out.push({ x: MID, y: by, z: 7 + i, c: MP.trunk });
        out.push({ x: MID, y: by, z: 7 - i, c: MP.trunk });
    }
    return out;
}

function boatProp(): Voxel[] {
    return compose(
        box(2, 4, 0, 8, 4, 1, MP.trunkDark),
        shell(2, 4, 1, 8, 4, 1, MP.trunk),
        box(5, 5, 2, 1, 1, 3, MP.white)
    );
}

function mykonosVoxelProp(propId: string): Voxel[] {
    switch (propId) {
        case 'cypress':
            return cypressProp();
        case 'olive-tree':
            return oliveProp();
        case 'bougainvillea':
            return bougainvilleaProp();
        case 'pot':
            return potProp();
        case 'lamp':
            return lanternProp();
        case 'well':
            return wellProp();
        case 'bench':
            return benchProp();
        case 'agave':
            return agaveProp();
        case 'windmill':
            return windmillProp();
        case 'boat':
            return boatProp();
        default:
            return potProp();
    }
}

// --- Composite buildings (footprint F tiles => F*VPT voxels per side) --------

/** Cobalt-framed windows spaced along all four faces at height z. */
function windowsAt(w: number, d: number, z: number): Voxel[] {
    const out: Voxel[] = [];
    for (let x = 4; x < w - 4; x += 8) {
        out.push(...box(x, 0, z, 3, 1, 4, MP.cobalt));
        out.push(...box(x, d - 1, z, 3, 1, 4, MP.cobalt));
    }
    for (let y = 4; y < d - 4; y += 8) {
        out.push(...box(0, y, z, 1, 3, 4, MP.cobalt));
        out.push(...box(w - 1, y, z, 1, 3, 4, MP.cobalt));
    }
    return out;
}

/** A cascade of bougainvillea climbing a building corner. */
function bougainCascade(): Voxel[] {
    return compose(
        box(0, 0, 1, 2, 2, 11, MP.bougain),
        box(0, 2, 4, 1, 2, 5, MP.bougainLight),
        box(2, 0, 4, 2, 1, 5, MP.bougainDark),
        box(0, 0, 12, 3, 3, 2, MP.bougainLight)
    );
}

/** A cobalt door centered on the front (y=0) face. */
function doorAt(w: number): Voxel[] {
    return box(Math.floor(w / 2) - 1, 0, 1, 3, 1, 6, MP.cobaltDeep);
}

/** Whitewashed box with a closed flat roof + parapet. */
function whiteBlock(w: number, d: number, h: number): Voxel[] {
    return compose(
        box(0, 0, 0, w, d, 1, MP.whiteShadow),
        shell(0, 0, 0, w, d, h, MP.white),
        box(0, 0, h - 1, w, d, 1, MP.whiteShadow),
        shell(0, 0, h, w, d, 1, MP.white)
    );
}

/** Cobalt railing (posts + top rail) around a w×d roof perimeter at height z. */
function roofRailing(w: number, d: number, z: number): Voxel[] {
    const out: Voxel[] = [];
    const post = (x: number, y: number): void => {
        out.push({ x, y, z, c: MP.cobalt }, { x, y, z: z + 1, c: MP.cobalt });
    };
    for (let x = 0; x < w; x++) {
        out.push({ x, y: 0, z: z + 1, c: MP.cobaltLight });
        out.push({ x, y: d - 1, z: z + 1, c: MP.cobaltLight });
        if (x % 3 === 0) {
            post(x, 0);
            post(x, d - 1);
        }
    }
    for (let y = 0; y < d; y++) {
        out.push({ x: 0, y, z: z + 1, c: MP.cobaltLight });
        out.push({ x: w - 1, y, z: z + 1, c: MP.cobaltLight });
        if (y % 3 === 0) {
            post(0, y);
            post(w - 1, y);
        }
    }
    return out;
}

/** A cobalt pergola: corner posts + slatted top over a w×d terrace at z. */
function pergola(
    x: number,
    y: number,
    w: number,
    d: number,
    z: number
): Voxel[] {
    const h = 5;
    const out: Voxel[] = [];
    for (const [px, py] of [
        [x, y],
        [x + w - 1, y],
        [x, y + d - 1],
        [x + w - 1, y + d - 1]
    ] as const) {
        out.push(...box(px, py, z, 1, 1, h, MP.cobalt));
    }
    for (let iy = y; iy < y + d; iy++) {
        const c = iy % 2 === 0 ? MP.cobalt : MP.cobaltLight;
        for (let ix = x; ix < x + w; ix++) {
            out.push({ x: ix, y: iy, z: z + h, c });
        }
    }
    return out;
}

/** A line of n terracotta pots (with a sprig), optionally stepping up in z. */
function potLine(
    x: number,
    y: number,
    axis: 'x' | 'y',
    n: number,
    z0: number,
    dz: number
): Voxel[] {
    const out: Voxel[] = [];
    for (let i = 0; i < n; i++) {
        const px = axis === 'x' ? x + i * 2 : x;
        const py = axis === 'y' ? y + i * 2 : y;
        const z = z0 + i * dz;
        out.push({ x: px, y: py, z, c: MP.terracotta });
        out.push({ x: px, y: py, z: z + 1, c: MP.olive });
        out.push({ x: px, y: py, z: z + 2, c: MP.bougain });
    }
    return out;
}

function cubeHouse(): Voxel[] {
    const w = 2 * VPT;
    return mergeVoxels(
        whiteBlock(w, w, 15),
        windowsAt(w, w, 7),
        doorAt(w),
        roofRailing(w, w, 15),
        potLine(3, 3, 'x', 3, 15, 0),
        bougainCascade()
    );
}

function twoStory(): Voxel[] {
    const w = 3 * VPT;
    const h1 = 16;
    const stairs: Voxel[] = [];
    for (let s = 0; s < 7; s++) {
        stairs.push(
            ...box(w - 3, 4 + s * 3, 1 + s * 2, 3, 3, 2, MP.whiteShadow)
        );
    }
    // Upper room sits at the back; the front half of the roof is an open terrace.
    const up = w - 14;
    return mergeVoxels(
        box(0, 0, 0, w, w, 1, MP.whiteShadow),
        shell(0, 0, 0, w, w, h1, MP.white),
        box(0, 0, h1 - 1, w, w, 1, MP.whiteShadow),
        whiteBlock(up, up, 14).map(v => ({
            ...v,
            x: v.x + 4,
            y: v.y + 10,
            z: v.z + h1
        })),
        windowsAt(w, w, 7),
        windowsAt(up, up, 5).map(v => ({
            ...v,
            x: v.x + 4,
            y: v.y + 10,
            z: v.z + h1
        })),
        doorAt(w),
        roofRailing(w, w, h1),
        pergola(3, 1, w - 6, 7, h1),
        potLine(2, 1, 'y', 5, h1, 0),
        stairs,
        potLine(w - 6, 4, 'y', 6, 1, 2),
        bougainCascade()
    );
}

function chapel(): Voxel[] {
    const w = 2 * VPT;
    const c = w / 2;
    const h = 14;
    return mergeVoxels(
        whiteBlock(w, w, h),
        cylinder(c, c, h, 6, 1, MP.white),
        dome(c, c, h + 1, 6, MP.cobalt),
        box(c, c, h + 8, 1, 1, 4, MP.white),
        box(c - 1, c, h + 10, 3, 1, 1, MP.white),
        windowsAt(w, w, 7),
        doorAt(w)
    );
}

function windmill(): Voxel[] {
    const w = 2 * VPT;
    const c = w / 2;
    const parts: Voxel[][] = [
        cylinder(c, c, 0, 7, 18, MP.white),
        cylinder(c, c, 18, 7, 1, MP.whiteShadow),
        doorAt(w)
    ];
    for (let iz = 0; iz < 6; iz++) {
        parts.push(
            cylinder(
                c,
                c,
                19 + iz,
                Math.max(0, 7 - iz),
                1,
                iz >= 5 ? MP.terraDark : MP.terracotta
            )
        );
    }
    const blades: Voxel[] = [{ x: c, y: 4, z: 14, c: MP.iron }];
    for (let i = 1; i <= 7; i++) {
        blades.push(
            { x: c + i, y: 4, z: 14, c: MP.trunk },
            { x: c - i, y: 4, z: 14, c: MP.trunk },
            { x: c, y: 4, z: 14 + i, c: MP.trunk },
            { x: c, y: 4, z: 14 - i, c: MP.trunk }
        );
    }
    parts.push(blades);
    return mergeVoxels(...parts);
}

function villa(): Voxel[] {
    const w = 4 * VPT;
    const up = Math.floor(w * 0.55);
    return mergeVoxels(
        whiteBlock(w, w, 16),
        // upper wing at the back-left corner; rest of the roof is a terrace
        whiteBlock(up, up, 13).map(v => ({
            ...v,
            y: v.y + (w - up),
            z: v.z + 16
        })),
        windowsAt(w, w, 7),
        windowsAt(up, up, 5).map(v => ({
            ...v,
            y: v.y + (w - up),
            z: v.z + 16
        })),
        doorAt(w),
        roofRailing(w, w, 16),
        pergola(2, 2, w - up - 2, w - 6, 16),
        potLine(2, 2, 'x', 6, 16, 0),
        bougainCascade()
    );
}

function mykonosStructure(type: string): Voxel[] {
    switch (type) {
        case 'two-story':
            return twoStory();
        case 'chapel':
            return chapel();
        case 'windmill':
            return windmill();
        case 'villa':
            return villa();
        default:
            return cubeHouse();
    }
}

const mykonosVoxels: BiomeVoxels = {
    perTile: VPT,
    surface: mykonosSurface,
    prop: mykonosVoxelProp,
    structure: mykonosStructure,
    catalog: {
        surfaces: [
            'water',
            'sand',
            'grass',
            'rock',
            'plaza',
            'path',
            'wall',
            'rooftop',
            'dome',
            'stairs'
        ],
        props: [
            'olive-tree',
            'cypress',
            'bougainvillea',
            'pot',
            'lamp',
            'well',
            'bench',
            'agave',
            'windmill',
            'boat'
        ],
        structures: ['cube-house', 'two-story', 'chapel', 'villa', 'windmill']
    }
};

const mykonosRenderer: BiomeRenderer = {
    tilePaletteIndex: id => MYKONOS_TILE_SLOT[id] ?? 0,
    buildProp: mykonosProp,
    voxels: mykonosVoxels
};

// ---------------------------------------------------------------------------
// Cyberpunk
// ---------------------------------------------------------------------------

const CYBERPUNK_TILE_SLOT: Record<string, number> = {
    canal: 6,
    quay: 5,
    street: 5,
    plaza: 3,
    market: 2,
    rubble: 4,
    scaffold: 4,
    tower: 0,
    highrise: 0,
    spire: 1
};

function cyberpunkProp(propId: string, palette: THREE.Color[]): THREE.Object3D {
    const group = new THREE.Group();
    const magenta = palette[1] ?? new THREE.Color('#ff2e88');
    const cyan = palette[2] ?? new THREE.Color('#00e5ff');
    const purple = palette[3] ?? new THREE.Color('#7a3cff');
    const steel = palette[5] ?? new THREE.Color('#2a3550');
    const neon = (c: THREE.Color) =>
        new THREE.MeshStandardMaterial({
            color: c,
            emissive: c,
            emissiveIntensity: 0.9,
            flatShading: true
        });

    switch (propId) {
        case 'neon-sign': {
            const sign = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 0.5, 0.18),
                neon(magenta)
            );
            sign.position.y = 0.5;
            group.add(sign);
            break;
        }
        case 'antenna': {
            const mast = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.03, 0.9, 6),
                standard(steel)
            );
            mast.position.y = 0.45;
            const tip = new THREE.Mesh(
                new THREE.SphereGeometry(0.05, 8, 8),
                neon(cyan)
            );
            tip.position.y = 0.95;
            group.add(mast, tip);
            break;
        }
        case 'beacon': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6),
                standard(steel)
            );
            post.position.y = 0.25;
            const light = new THREE.Mesh(
                new THREE.SphereGeometry(0.1, 10, 10),
                neon(magenta)
            );
            light.position.y = 0.6;
            group.add(post, light);
            break;
        }
        case 'holo': {
            const cone = new THREE.Mesh(
                new THREE.ConeGeometry(0.18, 0.5, 12, 1, true),
                new THREE.MeshStandardMaterial({
                    color: cyan,
                    emissive: cyan,
                    emissiveIntensity: 0.7,
                    transparent: true,
                    opacity: 0.5,
                    flatShading: true
                })
            );
            cone.position.y = 0.3;
            group.add(cone);
            break;
        }
        case 'drone': {
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.16, 0.05, 0.16),
                standard(steel)
            );
            body.position.y = 0.6;
            const dot = new THREE.Mesh(
                new THREE.SphereGeometry(0.03, 6, 6),
                neon(magenta)
            );
            dot.position.y = 0.57;
            group.add(body, dot);
            break;
        }
        case 'barrier': {
            const bar = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.16, 0.1),
                standard(steel)
            );
            bar.position.y = 0.08;
            const stripe = new THREE.Mesh(
                new THREE.BoxGeometry(0.42, 0.03, 0.02),
                neon(cyan)
            );
            stripe.position.y = 0.12;
            stripe.position.z = 0.06;
            group.add(bar, stripe);
            break;
        }
        case 'neon-lamp': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6),
                standard(steel)
            );
            post.position.y = 0.35;
            const bulb = new THREE.Mesh(
                new THREE.SphereGeometry(0.08, 8, 8),
                neon(purple)
            );
            bulb.position.y = 0.75;
            group.add(post, bulb);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.25, 0.25, 0.25),
                neon(cyan)
            );
            box.position.y = 0.13;
            group.add(box);
        }
    }
    return group;
}

const cyberpunkRenderer: BiomeRenderer = {
    tilePaletteIndex: id => CYBERPUNK_TILE_SLOT[id] ?? 0,
    buildProp: cyberpunkProp
};

// ---------------------------------------------------------------------------
// Cuban Beach
// ---------------------------------------------------------------------------

// palette: sand-cream[0], turquoise-sea[1], terracotta[2], palm-green[3],
//          thatch[4], shell-white[5], lagoon[6], sun-yellow[7]

const CUBAN_BEACH_TILE_SLOT: Record<string, number> = {
    sea: 1,
    shore: 0,
    sand: 0,
    'beach-grass': 3,
    dune: 0,
    path: 4,
    'palm-base': 3,
    'shack-floor': 5,
    shack: 5,
    'thatch-roof': 4
};

function cubanBeachProp(
    propId: string,
    palette: THREE.Color[]
): THREE.Object3D {
    const group = new THREE.Group();
    const sand = palette[0] ?? new THREE.Color('#f5e6c8');
    const terracotta = palette[2] ?? new THREE.Color('#d97942');
    const palmGreen = palette[3] ?? new THREE.Color('#3e8e41');
    const shellWhite = palette[5] ?? new THREE.Color('#fff5e8');
    const sunYellow = palette[7] ?? new THREE.Color('#f4d35e');
    const woodBrown = new THREE.Color('#7a5a3a');

    switch (propId) {
        case 'palm-tree': {
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.06, 0.08, 0.7, 6),
                standard(woodBrown)
            );
            trunk.position.y = 0.35;
            const leaves = new THREE.Mesh(
                new THREE.IcosahedronGeometry(0.28, 0),
                standard(palmGreen)
            );
            leaves.position.y = 0.8;
            group.add(trunk, leaves);
            break;
        }
        case 'fishing-boat': {
            const hull = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.1, 0.2),
                standard(terracotta)
            );
            hull.position.y = 0.05;
            group.add(hull);
            break;
        }
        case 'fishing-net': {
            const net = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.02, 0.3),
                standard(new THREE.Color('#d4c090'))
            );
            net.position.y = 0.01;
            group.add(net);
            break;
        }
        case 'driftwood': {
            const log = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.06, 0.06),
                standard(sand)
            );
            log.position.y = 0.03;
            group.add(log);
            break;
        }
        case 'conga-drum': {
            const drum = new THREE.Mesh(
                new THREE.CylinderGeometry(0.1, 0.08, 0.35, 8),
                standard(terracotta)
            );
            drum.position.y = 0.175;
            group.add(drum);
            break;
        }
        case 'hammock': {
            const hammock = new THREE.Mesh(
                new THREE.BoxGeometry(0.45, 0.04, 0.15),
                standard(shellWhite)
            );
            hammock.position.y = 0.35;
            group.add(hammock);
            break;
        }
        case 'conch-shell': {
            const shell = new THREE.Mesh(
                new THREE.SphereGeometry(0.1, 8, 6),
                standard(shellWhite)
            );
            shell.position.y = 0.1;
            group.add(shell);
            break;
        }
        case 'tiki-torch': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.03, 0.75, 6),
                standard(woodBrown)
            );
            post.position.y = 0.375;
            const ember = new THREE.Mesh(
                new THREE.SphereGeometry(0.06, 8, 8),
                new THREE.MeshStandardMaterial({
                    color: sunYellow,
                    emissive: sunYellow,
                    emissiveIntensity: 0.9,
                    flatShading: true
                })
            );
            ember.position.y = 0.8;
            group.add(post, ember);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(sand)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    return group;
}

const cubanBeachRenderer: BiomeRenderer = {
    tilePaletteIndex: id => CUBAN_BEACH_TILE_SLOT[id] ?? 0,
    buildProp: cubanBeachProp
};

// ---------------------------------------------------------------------------
// Rave Festival
// ---------------------------------------------------------------------------

// palette: night-black[0], electric-violet[1], laser-cyan[2], hot-magenta[3],
//          strobe-yellow[4], stage-steel[5], dust-earth[6], tent-white[7]

const RAVE_FESTIVAL_TILE_SLOT: Record<string, number> = {
    'perimeter-fence': 5,
    'dust-buffer': 6,
    'festival-field': 6,
    walkway: 7,
    'dance-floor': 1,
    'tent-camp': 7,
    'vendor-row': 3,
    'speaker-stack': 0,
    'laser-tower': 2,
    'main-stage': 4
};

function raveFestivalProp(
    propId: string,
    palette: THREE.Color[]
): THREE.Object3D {
    const group = new THREE.Group();
    const violet = palette[1] ?? new THREE.Color('#7f2cff');
    const cyan = palette[2] ?? new THREE.Color('#00f5ff');
    const magenta = palette[3] ?? new THREE.Color('#ff2bd6');
    const yellow = palette[4] ?? new THREE.Color('#f6f06d');
    const steel = palette[5] ?? new THREE.Color('#222436');
    const white = palette[7] ?? new THREE.Color('#f4f4f8');
    const neon = (c: THREE.Color) =>
        new THREE.MeshStandardMaterial({
            color: c,
            emissive: c,
            emissiveIntensity: 0.9,
            flatShading: true
        });

    switch (propId) {
        case 'laser-beam': {
            const beam = new THREE.Mesh(
                new THREE.BoxGeometry(0.03, 1.2, 0.03),
                neon(cyan)
            );
            beam.position.y = 0.6;
            group.add(beam);
            break;
        }
        case 'subwoofer': {
            const cab = new THREE.Mesh(
                new THREE.BoxGeometry(0.35, 0.4, 0.3),
                standard(steel)
            );
            cab.position.y = 0.2;
            group.add(cab);
            break;
        }
        case 'light-rig': {
            const bar = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.05, 0.05),
                standard(steel)
            );
            bar.position.y = 0.7;
            const bulb1 = new THREE.Mesh(
                new THREE.SphereGeometry(0.04, 6, 6),
                neon(magenta)
            );
            bulb1.position.set(-0.18, 0.62, 0);
            const bulb2 = new THREE.Mesh(
                new THREE.SphereGeometry(0.04, 6, 6),
                neon(cyan)
            );
            bulb2.position.set(0.18, 0.62, 0);
            group.add(bar, bulb1, bulb2);
            break;
        }
        case 'crowd-cluster': {
            for (let i = 0; i < 3; i++) {
                const person = new THREE.Mesh(
                    new THREE.BoxGeometry(0.1, 0.2, 0.1),
                    standard(i === 0 ? violet : i === 1 ? magenta : yellow)
                );
                person.position.set((i - 1) * 0.15, 0.1, 0);
                group.add(person);
            }
            break;
        }
        case 'food-truck': {
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.3, 0.25),
                standard(new THREE.Color('#4a5a4a'))
            );
            body.position.y = 0.15;
            const window = new THREE.Mesh(
                new THREE.BoxGeometry(0.18, 0.08, 0.02),
                neon(yellow)
            );
            window.position.set(0, 0.2, 0.135);
            group.add(body, window);
            break;
        }
        case 'flag': {
            const pole = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.02, 0.8, 6),
                standard(steel)
            );
            pole.position.y = 0.4;
            const banner = new THREE.Mesh(
                new THREE.BoxGeometry(0.25, 0.2, 0.02),
                neon(magenta)
            );
            banner.position.set(0.14, 0.7, 0);
            group.add(pole, banner);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.25, 0.25, 0.25),
                neon(violet)
            );
            box.position.y = 0.13;
            group.add(box);
        }
    }
    return group;
}

const raveFestivalRenderer: BiomeRenderer = {
    tilePaletteIndex: id => RAVE_FESTIVAL_TILE_SLOT[id] ?? 0,
    buildProp: raveFestivalProp
};

// ---------------------------------------------------------------------------
// Solarpunk
// ---------------------------------------------------------------------------

// palette: sun-cream[0], leaf-bright[1], deep-green[2], aqua-tech[3],
//          solar-gold[4], garden-soft[5], olive-structure[6], clean-white[7]

const SOLARPUNK_TILE_SLOT: Record<string, number> = {
    'bioswale-water': 3,
    'reed-bank': 5,
    'meadow-path': 0,
    'garden-bed': 1,
    'commons-plaza': 7,
    'solar-canopy': 4,
    'living-wall': 2,
    workshop: 6,
    'greenhouse-dome': 7,
    'wind-tree': 1
};

function solarpunkProp(propId: string, palette: THREE.Color[]): THREE.Object3D {
    const group = new THREE.Group();
    const cream = palette[0] ?? new THREE.Color('#f7f1d2');
    const leafBright = palette[1] ?? new THREE.Color('#7ac943');
    const deepGreen = palette[2] ?? new THREE.Color('#2f9e68');
    const solarGold = palette[4] ?? new THREE.Color('#f6c85f');
    const olive = palette[6] ?? new THREE.Color('#6b6f3a');
    const woodBrown = new THREE.Color('#7a5a3a');
    const steelBlue = new THREE.Color('#5b7fa6');

    switch (propId) {
        case 'solar-panel': {
            const panel = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.03, 0.3),
                standard(steelBlue)
            );
            panel.rotation.x = -0.25;
            panel.position.y = 0.45;
            group.add(panel);
            break;
        }
        case 'planter-box': {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.35, 0.12, 0.2),
                standard(new THREE.Color('#c66b3d'))
            );
            box.position.y = 0.06;
            const plant = new THREE.Mesh(
                new THREE.IcosahedronGeometry(0.12, 0),
                standard(leafBright)
            );
            plant.position.y = 0.22;
            group.add(box, plant);
            break;
        }
        case 'bike-rack': {
            const rack = new THREE.Mesh(
                new THREE.BoxGeometry(0.38, 0.04, 0.06),
                standard(olive)
            );
            rack.position.y = 0.4;
            const post1 = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6),
                standard(olive)
            );
            post1.position.set(-0.16, 0.2, 0);
            const post2 = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6),
                standard(olive)
            );
            post2.position.set(0.16, 0.2, 0);
            group.add(rack, post1, post2);
            break;
        }
        case 'rain-chain': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6),
                standard(deepGreen)
            );
            post.position.y = 0.3;
            const barrel = new THREE.Mesh(
                new THREE.CylinderGeometry(0.12, 0.12, 0.25, 8),
                standard(deepGreen)
            );
            barrel.position.y = 0.125;
            group.add(post, barrel);
            break;
        }
        case 'community-table': {
            const top = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.04, 0.28),
                standard(woodBrown)
            );
            top.position.y = 0.35;
            const leg1 = new THREE.Mesh(
                new THREE.BoxGeometry(0.04, 0.32, 0.04),
                standard(woodBrown)
            );
            leg1.position.set(-0.22, 0.16, 0);
            const leg2 = new THREE.Mesh(
                new THREE.BoxGeometry(0.04, 0.32, 0.04),
                standard(woodBrown)
            );
            leg2.position.set(0.22, 0.16, 0);
            group.add(top, leg1, leg2);
            break;
        }
        case 'birdhouse': {
            const mast = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.03, 0.7, 6),
                standard(woodBrown)
            );
            mast.position.y = 0.35;
            const house = new THREE.Mesh(
                new THREE.BoxGeometry(0.16, 0.14, 0.14),
                standard(cream)
            );
            house.position.y = 0.77;
            const roof = new THREE.Mesh(
                new THREE.ConeGeometry(0.13, 0.1, 4),
                standard(solarGold)
            );
            roof.position.y = 0.9;
            group.add(mast, house, roof);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(leafBright)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    return group;
}

const solarpunkRenderer: BiomeRenderer = {
    tilePaletteIndex: id => SOLARPUNK_TILE_SLOT[id] ?? 0,
    buildProp: solarpunkProp
};

// ---------------------------------------------------------------------------
// Bollywood Ghats
// ---------------------------------------------------------------------------

// palette: saffron[0], marigold[1], magenta[2], river-blue[3],
//          wood-brown[4], sandstone[5], royal-purple[6], leaf-green[7]

const BOLLYWOOD_GHATS_TILE_SLOT: Record<string, number> = {
    'sacred-river': 3,
    'wet-ghat': 5,
    'stone-steps': 5,
    'flower-market': 1,
    courtyard: 0,
    'boat-landing': 4,
    'market-stall': 2,
    'temple-wall': 5,
    shikhara: 6,
    'lamp-tower': 1
};

function bollywoodGhatsProp(
    propId: string,
    palette: THREE.Color[]
): THREE.Object3D {
    const group = new THREE.Group();
    const saffron = palette[0] ?? new THREE.Color('#f15a24');
    const marigold = palette[1] ?? new THREE.Color('#ffcc33');
    const magenta = palette[2] ?? new THREE.Color('#d7267d');
    const woodBrown = palette[4] ?? new THREE.Color('#8b4513');
    const clay = new THREE.Color('#c66b3d');
    const warmYellow = new THREE.Color('#ffe08a');
    const neonEmissive = (c: THREE.Color) =>
        new THREE.MeshStandardMaterial({
            color: c,
            emissive: c,
            emissiveIntensity: 0.8,
            flatShading: true
        });

    switch (propId) {
        case 'diya-lamp': {
            const cup = new THREE.Mesh(
                new THREE.CylinderGeometry(0.08, 0.05, 0.04, 8),
                standard(clay)
            );
            cup.position.y = 0.02;
            const glow = new THREE.Mesh(
                new THREE.SphereGeometry(0.05, 8, 8),
                neonEmissive(warmYellow)
            );
            glow.position.y = 0.07;
            group.add(cup, glow);
            break;
        }
        case 'marigold-garland': {
            for (let i = 0; i < 5; i++) {
                const flower = new THREE.Mesh(
                    new THREE.SphereGeometry(0.06, 6, 6),
                    standard(i % 2 === 0 ? marigold : saffron)
                );
                flower.position.set((i - 2) * 0.1, 0.06, 0);
                group.add(flower);
            }
            break;
        }
        case 'river-boat': {
            const hull = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.08, 0.2),
                standard(woodBrown)
            );
            hull.position.y = 0.04;
            group.add(hull);
            break;
        }
        case 'fabric-canopy': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.025, 0.65, 6),
                standard(woodBrown)
            );
            post.position.y = 0.325;
            const canopy = new THREE.Mesh(
                new THREE.BoxGeometry(0.45, 0.04, 0.35),
                standard(magenta)
            );
            canopy.position.y = 0.67;
            group.add(post, canopy);
            break;
        }
        case 'tabla-player': {
            // Simplified: two small drums side by side
            const drum1 = new THREE.Mesh(
                new THREE.CylinderGeometry(0.07, 0.06, 0.22, 8),
                standard(woodBrown)
            );
            drum1.position.set(-0.1, 0.11, 0);
            const drum2 = new THREE.Mesh(
                new THREE.CylinderGeometry(0.09, 0.08, 0.18, 8),
                standard(clay)
            );
            drum2.position.set(0.1, 0.09, 0);
            group.add(drum1, drum2);
            break;
        }
        case 'prayer-flag': {
            const pole = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.02, 0.8, 6),
                standard(woodBrown)
            );
            pole.position.y = 0.4;
            const flag = new THREE.Mesh(
                new THREE.BoxGeometry(0.25, 0.18, 0.02),
                standard(saffron)
            );
            flag.position.set(0.14, 0.71, 0);
            group.add(pole, flag);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(saffron)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    return group;
}

const bollywoodGhatsRenderer: BiomeRenderer = {
    tilePaletteIndex: id => BOLLYWOOD_GHATS_TILE_SLOT[id] ?? 0,
    buildProp: bollywoodGhatsProp
};

// ---------------------------------------------------------------------------
// Tobacco Plantation
// ---------------------------------------------------------------------------

// palette: red-earth[0], deep-tobacco[1], young-tobacco[2], olive[3],
//          limestone[4], wood-brown[5], stream-blue[6], thatch-cream[7]

const TOBACCO_PLANTATION_TILE_SLOT: Record<string, number> = {
    stream: 6,
    bank: 0,
    'red-earth': 0,
    field: 2,
    path: 0,
    'mogote-base': 4,
    'barn-floor': 5,
    bohio: 7,
    'curing-barn': 5,
    mogote: 4
};

function tobaccoPlantationProp(
    propId: string,
    palette: THREE.Color[]
): THREE.Object3D {
    const group = new THREE.Group();
    const redEarth = palette[0] ?? new THREE.Color('#8b5a3c');
    const olive = palette[3] ?? new THREE.Color('#6b8e23');
    const limestone = palette[4] ?? new THREE.Color('#d4b78f');
    const woodBrown = palette[5] ?? new THREE.Color('#4a3826');
    const thatchCream = palette[7] ?? new THREE.Color('#fce8c8');

    switch (propId) {
        case 'tobacco-plant': {
            const base = new THREE.Mesh(
                new THREE.BoxGeometry(0.18, 0.12, 0.18),
                standard(olive)
            );
            base.position.y = 0.06;
            const leaf1 = new THREE.Mesh(
                new THREE.BoxGeometry(0.22, 0.04, 0.08),
                standard(new THREE.Color('#a0c060'))
            );
            leaf1.position.y = 0.18;
            leaf1.rotation.y = 0.4;
            const leaf2 = new THREE.Mesh(
                new THREE.BoxGeometry(0.22, 0.04, 0.08),
                standard(new THREE.Color('#a0c060'))
            );
            leaf2.position.y = 0.22;
            leaf2.rotation.y = -0.4;
            group.add(base, leaf1, leaf2);
            break;
        }
        case 'ox-cart': {
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.45, 0.12, 0.2),
                standard(woodBrown)
            );
            body.position.y = 0.18;
            const wheelL = new THREE.Mesh(
                new THREE.CylinderGeometry(0.08, 0.08, 0.04, 8),
                standard(woodBrown)
            );
            wheelL.rotation.x = Math.PI / 2;
            wheelL.position.set(-0.18, 0.08, 0.12);
            const wheelR = wheelL.clone();
            wheelR.position.z = -0.12;
            group.add(body, wheelL, wheelR);
            break;
        }
        case 'drying-rack': {
            const bar = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.03, 0.03),
                standard(woodBrown)
            );
            bar.position.y = 0.55;
            const post1 = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.025, 0.55, 6),
                standard(woodBrown)
            );
            post1.position.set(-0.22, 0.275, 0);
            const post2 = post1.clone();
            post2.position.x = 0.22;
            const leaf = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.04, 0.02),
                standard(new THREE.Color('#a0c060'))
            );
            leaf.position.y = 0.48;
            group.add(bar, post1, post2, leaf);
            break;
        }
        case 'royal-palm': {
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.05, 0.07, 0.85, 6),
                standard(limestone)
            );
            trunk.position.y = 0.425;
            const canopy = new THREE.Mesh(
                new THREE.IcosahedronGeometry(0.3, 0),
                standard(olive)
            );
            canopy.position.y = 0.95;
            group.add(trunk, canopy);
            break;
        }
        case 'water-trough': {
            const trough = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.12, 0.16),
                standard(woodBrown)
            );
            trough.position.y = 0.06;
            group.add(trough);
            break;
        }
        case 'lantern': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6),
                standard(woodBrown)
            );
            post.position.y = 0.3;
            const bulb = new THREE.Mesh(
                new THREE.SphereGeometry(0.07, 8, 8),
                new THREE.MeshStandardMaterial({
                    color: thatchCream,
                    emissive: new THREE.Color('#ffe08a'),
                    emissiveIntensity: 0.8,
                    flatShading: true
                })
            );
            bulb.position.y = 0.67;
            group.add(post, bulb);
            break;
        }
        case 'rocking-chair': {
            const seat = new THREE.Mesh(
                new THREE.BoxGeometry(0.22, 0.04, 0.18),
                standard(woodBrown)
            );
            seat.position.y = 0.22;
            const back = new THREE.Mesh(
                new THREE.BoxGeometry(0.22, 0.2, 0.03),
                standard(woodBrown)
            );
            back.position.set(0, 0.33, -0.075);
            group.add(seat, back);
            break;
        }
        case 'rooster': {
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.12, 0.14, 0.1),
                standard(redEarth)
            );
            body.position.y = 0.13;
            const head = new THREE.Mesh(
                new THREE.BoxGeometry(0.07, 0.07, 0.07),
                standard(redEarth)
            );
            head.position.set(0.07, 0.22, 0);
            group.add(body, head);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(redEarth)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    return group;
}

const tobaccoPlantationRenderer: BiomeRenderer = {
    tilePaletteIndex: id => TOBACCO_PLANTATION_TILE_SLOT[id] ?? 0,
    buildProp: tobaccoPlantationProp
};

// ---------------------------------------------------------------------------
// Spanish Colonial
// ---------------------------------------------------------------------------

// palette: stucco-gold[0], clay-roof[1], wood-iron[2], fountain-blue[3],
//          limestone[4], iron-shadow[5], plaza-light[6], balcony-green[7]

const SPANISH_COLONIAL_TILE_SLOT: Record<string, number> = {
    'fountain-water': 3,
    'stone-edge': 4,
    cobblestone: 4,
    'arcade-walk': 6,
    'plaza-tile': 0,
    'stucco-wall': 0,
    balcony: 7,
    'market-arch': 1,
    'church-roof': 1,
    'bell-tower': 6
};

function spanishColonialProp(
    propId: string,
    palette: THREE.Color[]
): THREE.Object3D {
    const group = new THREE.Group();
    const stuccoGold = palette[0] ?? new THREE.Color('#f2d6a2');
    const clayRoof = palette[1] ?? new THREE.Color('#b85c38');
    const woodIron = palette[2] ?? new THREE.Color('#7c4a2d');
    const fountainBlue = palette[3] ?? new THREE.Color('#3d6f8e');
    const ironShadow = palette[5] ?? new THREE.Color('#2b2b32');
    const warmYellow = new THREE.Color('#ffe08a');

    switch (propId) {
        case 'wrought-lamp': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.03, 0.03, 0.75, 6),
                standard(ironShadow)
            );
            post.position.y = 0.375;
            const bulb = new THREE.Mesh(
                new THREE.SphereGeometry(0.08, 8, 8),
                new THREE.MeshStandardMaterial({
                    color: warmYellow,
                    emissive: warmYellow,
                    emissiveIntensity: 0.9,
                    flatShading: true
                })
            );
            bulb.position.y = 0.8;
            group.add(post, bulb);
            break;
        }
        case 'balcony-plant': {
            const pot = new THREE.Mesh(
                new THREE.CylinderGeometry(0.1, 0.08, 0.16, 8),
                standard(clayRoof)
            );
            pot.position.y = 0.08;
            const plant = new THREE.Mesh(
                new THREE.IcosahedronGeometry(0.13, 0),
                standard(new THREE.Color('#3a7a2a'))
            );
            plant.position.y = 0.24;
            group.add(pot, plant);
            break;
        }
        case 'guitarist': {
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.1, 0.22, 0.08),
                standard(stuccoGold)
            );
            body.position.y = 0.17;
            const head = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 0.08, 0.08),
                standard(stuccoGold)
            );
            head.position.y = 0.34;
            const guitar = new THREE.Mesh(
                new THREE.BoxGeometry(0.06, 0.18, 0.04),
                standard(woodIron)
            );
            guitar.position.set(0.09, 0.2, 0);
            group.add(body, head, guitar);
            break;
        }
        case 'market-cart': {
            const base = new THREE.Mesh(
                new THREE.BoxGeometry(0.42, 0.1, 0.22),
                standard(woodIron)
            );
            base.position.y = 0.18;
            const goods = new THREE.Mesh(
                new THREE.BoxGeometry(0.36, 0.1, 0.18),
                standard(clayRoof)
            );
            goods.position.y = 0.29;
            group.add(base, goods);
            break;
        }
        case 'bench': {
            const seat = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.05, 0.15),
                standard(fountainBlue)
            );
            seat.position.y = 0.28;
            const back = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.18, 0.04),
                standard(fountainBlue)
            );
            back.position.set(0, 0.39, -0.055);
            group.add(seat, back);
            break;
        }
        case 'church-bell': {
            const yoke = new THREE.Mesh(
                new THREE.BoxGeometry(0.18, 0.05, 0.05),
                standard(ironShadow)
            );
            yoke.position.y = 0.5;
            const bell = new THREE.Mesh(
                new THREE.CylinderGeometry(0.06, 0.1, 0.14, 8),
                standard(new THREE.Color('#c9a84c'))
            );
            bell.position.y = 0.32;
            group.add(yoke, bell);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(stuccoGold)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    return group;
}

const spanishColonialRenderer: BiomeRenderer = {
    tilePaletteIndex: id => SPANISH_COLONIAL_TILE_SLOT[id] ?? 0,
    buildProp: spanishColonialProp
};

// ---------------------------------------------------------------------------
// Jazz Quarter
// ---------------------------------------------------------------------------

// palette: night-plum[0], brick-red[1], brass[2], lamp-gold[3],
//          blue-shadow[4], canal-black[5], wet-stone[6], cream-light[7]

const JAZZ_QUARTER_TILE_SLOT: Record<string, number> = {
    'canal-shadow': 5,
    'wet-curb': 6,
    'brick-street': 1,
    alley: 0,
    courtyard: 7,
    'jazz-club': 1,
    'iron-balcony': 4,
    'corner-cafe': 2,
    'hotel-roof': 0,
    'clock-tower': 3
};

function jazzQuarterProp(
    propId: string,
    palette: THREE.Color[]
): THREE.Object3D {
    const group = new THREE.Group();
    const nightPlum = palette[0] ?? new THREE.Color('#1b1720');
    const brass = palette[2] ?? new THREE.Color('#c29a5b');
    const lampGold = palette[3] ?? new THREE.Color('#f2d27a');
    const blueShadow = palette[4] ?? new THREE.Color('#2f4858');
    const wetStone = palette[6] ?? new THREE.Color('#8b7a6b');
    const creamLight = palette[7] ?? new THREE.Color('#ede1c5');
    const neonEmissive = (c: THREE.Color) =>
        new THREE.MeshStandardMaterial({
            color: c,
            emissive: c,
            emissiveIntensity: 0.85,
            flatShading: true
        });

    switch (propId) {
        case 'streetlamp': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.03, 0.035, 0.8, 6),
                standard(wetStone)
            );
            post.position.y = 0.4;
            const bulb = new THREE.Mesh(
                new THREE.SphereGeometry(0.09, 8, 8),
                neonEmissive(lampGold)
            );
            bulb.position.y = 0.87;
            group.add(post, bulb);
            break;
        }
        case 'sax-player': {
            const legs = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.04, 0.16, 6),
                standard(nightPlum)
            );
            legs.position.y = 0.08;
            const torso = new THREE.Mesh(
                new THREE.CylinderGeometry(0.07, 0.06, 0.2, 6),
                standard(nightPlum)
            );
            torso.position.y = 0.26;
            const head = new THREE.Mesh(
                new THREE.SphereGeometry(0.07, 8, 8),
                standard(creamLight)
            );
            head.position.y = 0.41;
            const sax = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.04, 0.28, 6),
                standard(brass)
            );
            sax.position.set(0.1, 0.28, 0);
            sax.rotation.z = 0.5;
            group.add(legs, torso, head, sax);
            break;
        }
        case 'club-sign': {
            const sign = new THREE.Mesh(
                new THREE.BoxGeometry(0.36, 0.16, 0.04),
                neonEmissive(lampGold)
            );
            sign.position.y = 0.55;
            group.add(sign);
            break;
        }
        case 'cafe-table': {
            const top = new THREE.Mesh(
                new THREE.CylinderGeometry(0.18, 0.18, 0.04, 8),
                standard(brass)
            );
            top.position.y = 0.38;
            const leg = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.02, 0.36, 6),
                standard(wetStone)
            );
            leg.position.y = 0.18;
            group.add(top, leg);
            break;
        }
        case 'balcony-rail': {
            const rail = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.04, 0.04),
                standard(blueShadow)
            );
            rail.position.y = 0.5;
            const post1 = new THREE.Mesh(
                new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6),
                standard(blueShadow)
            );
            post1.position.set(-0.2, 0.25, 0);
            const post2 = post1.clone();
            post2.position.x = 0.2;
            group.add(rail, post1, post2);
            break;
        }
        case 'poster-wall': {
            const wall = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.4, 0.03),
                standard(wetStone)
            );
            wall.position.y = 0.25;
            const poster = new THREE.Mesh(
                new THREE.BoxGeometry(0.2, 0.28, 0.04),
                neonEmissive(brass)
            );
            poster.position.y = 0.27;
            group.add(wall, poster);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(nightPlum)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    return group;
}

const jazzQuarterRenderer: BiomeRenderer = {
    tilePaletteIndex: id => JAZZ_QUARTER_TILE_SLOT[id] ?? 0,
    buildProp: jazzQuarterProp
};

// ---------------------------------------------------------------------------
// Nordic Fjord
// ---------------------------------------------------------------------------

// palette: polar-night[0], fjord-blue[1], lichen-gray[2], pine-green[3],
//          snow[4], basalt[5], turf-brown[6], aurora-mint[7]

const NORDIC_FJORD_TILE_SLOT: Record<string, number> = {
    'fjord-water': 1,
    'pebble-shore': 2,
    'moss-field': 2,
    'pine-stand': 3,
    'turf-path': 6,
    'black-cliff': 5,
    'turf-cabin': 6,
    runestone: 2,
    'snow-ridge': 4,
    'aurora-peak': 7
};

function nordicFjordProp(
    propId: string,
    palette: THREE.Color[]
): THREE.Object3D {
    const group = new THREE.Group();
    const fjordBlue = palette[1] ?? new THREE.Color('#1f4e5f');
    const lichenGray = palette[2] ?? new THREE.Color('#6f7d6b');
    const pineGreen = palette[3] ?? new THREE.Color('#263b2c');
    const snow = palette[4] ?? new THREE.Color('#dfe7ea');
    const basalt = palette[5] ?? new THREE.Color('#2b2b2f');
    const turfBrown = palette[6] ?? new THREE.Color('#8a5f3d');
    const auroraMint = palette[7] ?? new THREE.Color('#7fe7d7');

    switch (propId) {
        case 'pine-tree': {
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.045, 0.065, 0.4, 6),
                standard(turfBrown)
            );
            trunk.position.y = 0.2;
            const body = new THREE.Mesh(
                new THREE.ConeGeometry(0.24, 0.75, 7),
                standard(pineGreen)
            );
            body.position.y = 0.775;
            group.add(trunk, body);
            break;
        }
        case 'longboat': {
            const hull = new THREE.Mesh(
                new THREE.BoxGeometry(0.6, 0.1, 0.18),
                standard(turfBrown)
            );
            hull.position.y = 0.05;
            const prowF = new THREE.Mesh(
                new THREE.BoxGeometry(0.12, 0.14, 0.16),
                standard(turfBrown)
            );
            prowF.position.set(0.34, 0.1, 0);
            const prowA = prowF.clone();
            prowA.position.x = -0.34;
            group.add(hull, prowF, prowA);
            break;
        }
        case 'rune-marker': {
            const stone = new THREE.Mesh(
                new THREE.BoxGeometry(0.14, 0.45, 0.08),
                standard(lichenGray)
            );
            stone.position.y = 0.225;
            const cap = new THREE.Mesh(
                new THREE.SphereGeometry(0.07, 6, 6),
                standard(lichenGray)
            );
            cap.position.y = 0.47;
            group.add(stone, cap);
            break;
        }
        case 'smoke-plume': {
            const base = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.06, 0.3, 6),
                standard(basalt)
            );
            base.position.y = 0.15;
            const puff = new THREE.Mesh(
                new THREE.SphereGeometry(0.1, 6, 6),
                standard(snow)
            );
            puff.position.y = 0.38;
            group.add(base, puff);
            break;
        }
        case 'snow-drift': {
            const drift = new THREE.Mesh(
                new THREE.BoxGeometry(0.45, 0.1, 0.22),
                standard(snow)
            );
            drift.position.y = 0.05;
            group.add(drift);
            break;
        }
        case 'torch': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.03, 0.65, 6),
                standard(turfBrown)
            );
            post.position.y = 0.325;
            const flame = new THREE.Mesh(
                new THREE.SphereGeometry(0.07, 8, 8),
                new THREE.MeshStandardMaterial({
                    color: auroraMint,
                    emissive: new THREE.Color('#ffaa33'),
                    emissiveIntensity: 0.9,
                    flatShading: true
                })
            );
            flame.position.y = 0.7;
            group.add(post, flame);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(fjordBlue)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    return group;
}

const nordicFjordRenderer: BiomeRenderer = {
    tilePaletteIndex: id => NORDIC_FJORD_TILE_SLOT[id] ?? 0,
    buildProp: nordicFjordProp
};

// ---------------------------------------------------------------------------
// Tokyo City Pop
// ---------------------------------------------------------------------------

// palette: indigo-night[0], pink-neon[1], aqua-screen[2], city-gold[3],
//          violet-glow[4], crosswalk-white[5], asphalt[6], mint-light[7]

const TOKYO_CITY_POP_TILE_SLOT: Record<string, number> = {
    'metro-moat': 6,
    'station-edge': 5,
    crosswalk: 5,
    sidewalk: 6,
    'record-shop': 3,
    konbini: 7,
    'billboard-block': 1,
    'apartment-stack': 0,
    'rooftop-sign': 4,
    'tower-screen': 2
};

function tokyoCityPopProp(
    propId: string,
    palette: THREE.Color[]
): THREE.Object3D {
    const group = new THREE.Group();
    const indigoNight = palette[0] ?? new THREE.Color('#16162a');
    const pinkNeon = palette[1] ?? new THREE.Color('#ff6fb1');
    const aquaScreen = palette[2] ?? new THREE.Color('#45d6ff');
    const cityGold = palette[3] ?? new THREE.Color('#f6d365');
    const violetGlow = palette[4] ?? new THREE.Color('#7b61ff');
    const crosswalkWhite = palette[5] ?? new THREE.Color('#f3f3f5');
    const neonEmissive = (c: THREE.Color) =>
        new THREE.MeshStandardMaterial({
            color: c,
            emissive: c,
            emissiveIntensity: 0.9,
            flatShading: true
        });

    switch (propId) {
        case 'vending-machine': {
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.22, 0.42, 0.18),
                standard(indigoNight)
            );
            body.position.y = 0.21;
            const stripe = new THREE.Mesh(
                new THREE.BoxGeometry(0.2, 0.08, 0.02),
                neonEmissive(pinkNeon)
            );
            stripe.position.set(0, 0.28, 0.1);
            group.add(body, stripe);
            break;
        }
        case 'traffic-light': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6),
                standard(new THREE.Color('#444444'))
            );
            post.position.y = 0.35;
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.07, 0.18, 0.07),
                standard(indigoNight)
            );
            box.position.y = 0.75;
            const light = new THREE.Mesh(
                new THREE.SphereGeometry(0.03, 6, 6),
                neonEmissive(cityGold)
            );
            light.position.y = 0.77;
            group.add(post, box, light);
            break;
        }
        case 'vinyl-crate': {
            const crate = new THREE.Mesh(
                new THREE.BoxGeometry(0.28, 0.2, 0.18),
                standard(new THREE.Color('#5a4030'))
            );
            crate.position.y = 0.1;
            const record = new THREE.Mesh(
                new THREE.BoxGeometry(0.02, 0.16, 0.16),
                standard(indigoNight)
            );
            record.position.set(0.1, 0.16, 0);
            group.add(crate, record);
            break;
        }
        case 'neon-kanban': {
            const sign = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 0.4, 0.2),
                neonEmissive(aquaScreen)
            );
            sign.position.y = 0.5;
            group.add(sign);
            break;
        }
        case 'capsule-sign': {
            const sign = new THREE.Mesh(
                new THREE.BoxGeometry(0.32, 0.14, 0.04),
                neonEmissive(violetGlow)
            );
            sign.position.y = 0.6;
            group.add(sign);
            break;
        }
        case 'street-bike': {
            const frame = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.08, 0.1),
                standard(new THREE.Color('#444466'))
            );
            frame.position.y = 0.12;
            const wheelF = new THREE.Mesh(
                new THREE.BoxGeometry(0.06, 0.14, 0.14),
                standard(indigoNight)
            );
            wheelF.position.set(0.13, 0.07, 0);
            const wheelR = wheelF.clone();
            wheelR.position.x = -0.13;
            group.add(frame, wheelF, wheelR);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                neonEmissive(pinkNeon)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    return group;
}

const tokyoCityPopRenderer: BiomeRenderer = {
    tilePaletteIndex: id => TOKYO_CITY_POP_TILE_SLOT[id] ?? 0,
    buildProp: tokyoCityPopProp
};

// ---------------------------------------------------------------------------
// Desert Oasis
// ---------------------------------------------------------------------------

// palette: gold-sand[0], amber-dune[1], mudbrick[2], oasis-blue[3],
//          palm-green[4], sun-cream[5], shadow-brown[6], salt-white[7]

const DESERT_OASIS_TILE_SLOT: Record<string, number> = {
    'salt-pan': 7,
    'dune-rim': 1,
    'sand-flat': 0,
    'palm-oasis': 4,
    'caravan-path': 5,
    'tent-camp': 6,
    'mudbrick-wall': 2,
    'market-court': 5,
    minaret: 2,
    'dune-crest': 1
};

function desertOasisProp(
    propId: string,
    palette: THREE.Color[]
): THREE.Object3D {
    const group = new THREE.Group();
    const goldSand = palette[0] ?? new THREE.Color('#f2c879');
    const mudbrick = palette[2] ?? new THREE.Color('#8a4f2a');
    const oasisBlue = palette[3] ?? new THREE.Color('#1f9fb4');
    const palmGreen = palette[4] ?? new THREE.Color('#2f6f4e');
    const shadowBrown = palette[6] ?? new THREE.Color('#3a2a2a');
    const warmYellow = new THREE.Color('#ffe08a');

    switch (propId) {
        case 'date-palm': {
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.05, 0.07, 0.75, 6),
                standard(mudbrick)
            );
            trunk.position.y = 0.375;
            const cluster1 = new THREE.Mesh(
                new THREE.BoxGeometry(0.2, 0.08, 0.12),
                standard(palmGreen)
            );
            cluster1.position.set(0.1, 0.82, 0);
            const cluster2 = new THREE.Mesh(
                new THREE.BoxGeometry(0.12, 0.08, 0.2),
                standard(palmGreen)
            );
            cluster2.position.set(-0.06, 0.88, 0.06);
            const cluster3 = new THREE.Mesh(
                new THREE.BoxGeometry(0.16, 0.06, 0.1),
                standard(palmGreen)
            );
            cluster3.position.set(0, 0.86, -0.1);
            group.add(trunk, cluster1, cluster2, cluster3);
            break;
        }
        case 'camel': {
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.35, 0.18, 0.18),
                standard(goldSand)
            );
            body.position.y = 0.25;
            const neck = new THREE.Mesh(
                new THREE.CylinderGeometry(0.05, 0.06, 0.2, 6),
                standard(goldSand)
            );
            neck.position.set(0.17, 0.38, 0);
            neck.rotation.z = -0.4;
            const head = new THREE.Mesh(
                new THREE.BoxGeometry(0.1, 0.1, 0.09),
                standard(goldSand)
            );
            head.position.set(0.27, 0.5, 0);
            group.add(body, neck, head);
            break;
        }
        case 'water-jar': {
            const jar = new THREE.Mesh(
                new THREE.CylinderGeometry(0.1, 0.07, 0.28, 8),
                standard(mudbrick)
            );
            jar.position.y = 0.14;
            group.add(jar);
            break;
        }
        case 'woven-rug': {
            const rug = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.02, 0.3),
                standard(new THREE.Color('#c05a2a'))
            );
            rug.position.y = 0.01;
            group.add(rug);
            break;
        }
        case 'lantern': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.025, 0.55, 6),
                standard(shadowBrown)
            );
            post.position.y = 0.275;
            const bulb = new THREE.Mesh(
                new THREE.SphereGeometry(0.08, 8, 8),
                new THREE.MeshStandardMaterial({
                    color: warmYellow,
                    emissive: warmYellow,
                    emissiveIntensity: 0.85,
                    flatShading: true
                })
            );
            bulb.position.y = 0.62;
            group.add(post, bulb);
            break;
        }
        case 'wind-banner': {
            const pole = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.02, 0.8, 6),
                standard(shadowBrown)
            );
            pole.position.y = 0.4;
            const banner = new THREE.Mesh(
                new THREE.BoxGeometry(0.22, 0.16, 0.02),
                standard(oasisBlue)
            );
            banner.position.set(0.12, 0.72, 0);
            group.add(pole, banner);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(goldSand)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    return group;
}

const desertOasisRenderer: BiomeRenderer = {
    tilePaletteIndex: id => DESERT_OASIS_TILE_SLOT[id] ?? 0,
    buildProp: desertOasisProp
};

// ---------------------------------------------------------------------------
// Rio Carnival
// ---------------------------------------------------------------------------

// palette: bay-blue[0], sun-yellow[1], carnival-pink[2], tropical-green[3],
//          violet[4], sand-cream[5], orange[6], night-shadow[7]

const RIO_CARNIVAL_TILE_SLOT: Record<string, number> = {
    'bay-water': 0,
    'beach-edge': 5,
    'parade-street': 7,
    'confetti-plaza': 1,
    'tropical-garden': 3,
    'samba-stand': 2,
    'float-base': 6,
    'hillside-house': 5,
    'feather-tower': 4,
    'sun-statue': 1
};

function rioCarnivalProp(
    propId: string,
    palette: THREE.Color[]
): THREE.Object3D {
    const group = new THREE.Group();
    const bayBlue = palette[0] ?? new THREE.Color('#00a6d6');
    const sunYellow = palette[1] ?? new THREE.Color('#ffd23f');
    const carnivalPink = palette[2] ?? new THREE.Color('#ff3366');
    const tropicalGreen = palette[3] ?? new THREE.Color('#00b050');
    const violet = palette[4] ?? new THREE.Color('#7b2cff');
    const orange = palette[6] ?? new THREE.Color('#e87522');

    switch (propId) {
        case 'confetti-burst': {
            const colors = [
                carnivalPink,
                sunYellow,
                violet,
                tropicalGreen,
                orange
            ];
            for (let i = 0; i < 5; i++) {
                const fleck = new THREE.Mesh(
                    new THREE.BoxGeometry(0.06, 0.06, 0.02),
                    standard(colors[i]!)
                );
                fleck.position.set(
                    (Math.random() - 0.5) * 0.3,
                    0.1 + i * 0.08,
                    (Math.random() - 0.5) * 0.3
                );
                fleck.rotation.z = i * 0.5;
                group.add(fleck);
            }
            break;
        }
        case 'samba-drum': {
            const drum = new THREE.Mesh(
                new THREE.CylinderGeometry(0.12, 0.1, 0.22, 10),
                standard(carnivalPink)
            );
            drum.position.y = 0.11;
            group.add(drum);
            break;
        }
        case 'feather-arch': {
            const base = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.14, 0.14),
                standard(sunYellow)
            );
            base.position.y = 0.55;
            const featherL = new THREE.Mesh(
                new THREE.BoxGeometry(0.06, 0.3, 0.06),
                standard(carnivalPink)
            );
            featherL.position.set(-0.22, 0.75, 0);
            const featherR = featherL.clone();
            featherR.position.x = 0.22;
            group.add(base, featherL, featherR);
            break;
        }
        case 'street-vendor': {
            const cart = new THREE.Mesh(
                new THREE.BoxGeometry(0.32, 0.18, 0.2),
                standard(orange)
            );
            cart.position.y = 0.2;
            const canopy = new THREE.Mesh(
                new THREE.BoxGeometry(0.38, 0.04, 0.26),
                standard(carnivalPink)
            );
            canopy.position.y = 0.35;
            group.add(cart, canopy);
            break;
        }
        case 'tropical-flower': {
            const stem = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.02, 0.28, 6),
                standard(tropicalGreen)
            );
            stem.position.y = 0.14;
            const bloom = new THREE.Mesh(
                new THREE.IcosahedronGeometry(0.1, 0),
                standard(carnivalPink)
            );
            bloom.position.y = 0.32;
            group.add(stem, bloom);
            break;
        }
        case 'flag-string': {
            const line = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.02, 0.02),
                standard(bayBlue)
            );
            line.position.y = 0.55;
            const flag1 = new THREE.Mesh(
                new THREE.BoxGeometry(0.06, 0.08, 0.02),
                standard(sunYellow)
            );
            flag1.position.set(-0.15, 0.47, 0);
            const flag2 = new THREE.Mesh(
                new THREE.BoxGeometry(0.06, 0.08, 0.02),
                standard(carnivalPink)
            );
            flag2.position.set(0.15, 0.47, 0);
            group.add(line, flag1, flag2);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(carnivalPink)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    return group;
}

const rioCarnivalRenderer: BiomeRenderer = {
    tilePaletteIndex: id => RIO_CARNIVAL_TILE_SLOT[id] ?? 0,
    buildProp: rioCarnivalProp
};

// ---------------------------------------------------------------------------
// Jungle Canopy
// ---------------------------------------------------------------------------

// palette: deep-jungle[0], leaf-shadow[1], leaf-bright[2], lime-moss[3],
//          wood[4], dark-root[5], water-teal[6], mist-light[7]

const JUNGLE_CANOPY_TILE_SLOT: Record<string, number> = {
    'marsh-water': 6,
    'mud-root': 5,
    'forest-floor': 0,
    'fern-patch': 2,
    'root-path': 4,
    'tree-platform': 4,
    'rope-bridge': 5,
    'canopy-hut': 4,
    'giant-kapok': 1,
    'mist-crown': 7
};

function jungleCanopyProp(
    propId: string,
    palette: THREE.Color[]
): THREE.Object3D {
    const group = new THREE.Group();
    const deepJungle = palette[0] ?? new THREE.Color('#0b3d2e');
    const leafBright = palette[2] ?? new THREE.Color('#55a630');
    const limeMoss = palette[3] ?? new THREE.Color('#9bc53d');
    const wood = palette[4] ?? new THREE.Color('#6b4f2a');
    const waterTeal = palette[6] ?? new THREE.Color('#47c2b1');
    const fireOrange = new THREE.Color('#ff6820');

    switch (propId) {
        case 'vine-curtain': {
            for (let i = 0; i < 4; i++) {
                const vine = new THREE.Mesh(
                    new THREE.BoxGeometry(0.03, 0.6, 0.03),
                    standard(deepJungle)
                );
                vine.position.set((i - 1.5) * 0.1, 0.3, 0);
                group.add(vine);
            }
            break;
        }
        case 'bird-flock': {
            for (let i = 0; i < 3; i++) {
                const bird = new THREE.Mesh(
                    new THREE.BoxGeometry(0.1, 0.04, 0.06),
                    standard(leafBright)
                );
                bird.position.set((i - 1) * 0.14, 0.5 + i * 0.07, 0);
                group.add(bird);
            }
            break;
        }
        case 'drum-circle': {
            for (let i = 0; i < 3; i++) {
                const angle = (i / 3) * Math.PI * 2;
                const drum = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.06, 0.05, 0.18, 8),
                    standard(wood)
                );
                drum.position.set(
                    Math.cos(angle) * 0.18,
                    0.09,
                    Math.sin(angle) * 0.18
                );
                group.add(drum);
            }
            break;
        }
        case 'lantern-orchid': {
            const stem = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.02, 0.32, 6),
                standard(leafBright)
            );
            stem.position.y = 0.16;
            const glow = new THREE.Mesh(
                new THREE.SphereGeometry(0.08, 8, 8),
                new THREE.MeshStandardMaterial({
                    color: waterTeal,
                    emissive: waterTeal,
                    emissiveIntensity: 0.7,
                    flatShading: true
                })
            );
            glow.position.y = 0.37;
            group.add(stem, glow);
            break;
        }
        case 'hammock': {
            const hammock = new THREE.Mesh(
                new THREE.BoxGeometry(0.45, 0.04, 0.15),
                standard(limeMoss)
            );
            hammock.position.y = 0.38;
            group.add(hammock);
            break;
        }
        case 'rope-knot': {
            const sphere = new THREE.Mesh(
                new THREE.IcosahedronGeometry(0.08, 0),
                standard(wood)
            );
            sphere.position.y = 0.4;
            const rope = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6),
                standard(wood)
            );
            rope.position.y = 0.2;
            group.add(rope, sphere);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(deepJungle)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    // suppress unused warning for fireOrange (kept for future fire-pit prop)
    void fireOrange;
    return group;
}

const jungleCanopyRenderer: BiomeRenderer = {
    tilePaletteIndex: id => JUNGLE_CANOPY_TILE_SLOT[id] ?? 0,
    buildProp: jungleCanopyProp
};

// ---------------------------------------------------------------------------
// Arctic Base
// ---------------------------------------------------------------------------

// palette: snow-white[0], ice-blue[1], crevasse-blue[2], polar-steel[3],
//          lab-white[4], gray-metal[5], warning-orange[6], sea-black[7]

const ARCTIC_BASE_TILE_SLOT: Record<string, number> = {
    'black-sea-ice': 7,
    'ice-shelf': 1,
    snowfield: 0,
    'wind-track': 4,
    'crevasse-blue': 2,
    'hab-module': 5,
    'lab-block': 4,
    'antenna-mast': 3,
    radome: 4,
    'ice-ridge': 1
};

function arcticBaseProp(
    propId: string,
    palette: THREE.Color[]
): THREE.Object3D {
    const group = new THREE.Group();
    const snowWhite = palette[0] ?? new THREE.Color('#eef7ff');
    const iceBlue = palette[1] ?? new THREE.Color('#b9d8e8');
    const polarSteel = palette[3] ?? new THREE.Color('#182033');
    const grayMetal = palette[5] ?? new THREE.Color('#7a8699');
    const warningOrange = palette[6] ?? new THREE.Color('#ff6b35');

    switch (propId) {
        case 'weather-sensor': {
            const mast = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.02, 0.55, 6),
                standard(grayMetal)
            );
            mast.position.y = 0.275;
            const sensor = new THREE.Mesh(
                new THREE.BoxGeometry(0.1, 0.06, 0.06),
                standard(snowWhite)
            );
            sensor.position.y = 0.58;
            group.add(mast, sensor);
            break;
        }
        case 'orange-beacon': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.025, 0.65, 6),
                standard(grayMetal)
            );
            post.position.y = 0.325;
            const light = new THREE.Mesh(
                new THREE.SphereGeometry(0.09, 8, 8),
                new THREE.MeshStandardMaterial({
                    color: warningOrange,
                    emissive: warningOrange,
                    emissiveIntensity: 0.9,
                    flatShading: true
                })
            );
            light.position.y = 0.7;
            group.add(post, light);
            break;
        }
        case 'snow-cat': {
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.14, 0.2),
                standard(new THREE.Color('#cc4400'))
            );
            body.position.y = 0.14;
            const cab = new THREE.Mesh(
                new THREE.BoxGeometry(0.16, 0.14, 0.18),
                standard(grayMetal)
            );
            cab.position.set(0.1, 0.28, 0);
            group.add(body, cab);
            break;
        }
        case 'supply-crate': {
            const crate = new THREE.Mesh(
                new THREE.BoxGeometry(0.28, 0.22, 0.24),
                standard(grayMetal)
            );
            crate.position.y = 0.11;
            const stripe = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.04, 0.02),
                standard(warningOrange)
            );
            stripe.position.set(0, 0.15, 0.13);
            group.add(crate, stripe);
            break;
        }
        case 'satellite-dish': {
            const mast = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.025, 0.45, 6),
                standard(polarSteel)
            );
            mast.position.y = 0.225;
            const dish = new THREE.Mesh(
                new THREE.ConeGeometry(0.18, 0.14, 10),
                standard(grayMetal)
            );
            dish.rotation.x = Math.PI;
            dish.position.y = 0.52;
            group.add(mast, dish);
            break;
        }
        case 'ice-marker': {
            const flag = new THREE.Mesh(
                new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6),
                standard(grayMetal)
            );
            flag.position.y = 0.25;
            const banner = new THREE.Mesh(
                new THREE.BoxGeometry(0.12, 0.1, 0.02),
                standard(warningOrange)
            );
            banner.position.set(0.07, 0.45, 0);
            group.add(flag, banner);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(iceBlue)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    return group;
}

const arcticBaseRenderer: BiomeRenderer = {
    tilePaletteIndex: id => ARCTIC_BASE_TILE_SLOT[id] ?? 0,
    buildProp: arcticBaseProp
};

// ---------------------------------------------------------------------------
// Amazon River Village
// ---------------------------------------------------------------------------

// palette: river-brown[0], mud-gold[1], jungle-green[2], garden-green[3],
//          wood[4], thatch[5], water-blue[6], sun-cream[7]

const AMAZON_RIVER_VILLAGE_TILE_SLOT: Record<string, number> = {
    'brown-river': 0,
    'mud-bank': 1,
    floodplain: 2,
    'canoe-channel': 6,
    'garden-bank': 3,
    'stilt-house': 4,
    'market-deck': 5,
    'watch-pier': 4,
    'ceiba-crown': 2,
    'radio-tower': 7
};

function amazonRiverVillageProp(
    propId: string,
    palette: THREE.Color[]
): THREE.Object3D {
    const group = new THREE.Group();
    const riverBrown = palette[0] ?? new THREE.Color('#6b4a2f');
    const jungleGreen = palette[2] ?? new THREE.Color('#1f6f4a');
    const wood = palette[4] ?? new THREE.Color('#c58b4b');
    const thatch = palette[5] ?? new THREE.Color('#e7c88f');
    const fireOrange = new THREE.Color('#ff6820');
    const brightRed = new THREE.Color('#cc2222');

    switch (propId) {
        case 'canoe': {
            const hull = new THREE.Mesh(
                new THREE.BoxGeometry(0.52, 0.08, 0.16),
                standard(riverBrown)
            );
            hull.position.y = 0.04;
            group.add(hull);
            break;
        }
        case 'fish-basket': {
            const basket = new THREE.Mesh(
                new THREE.CylinderGeometry(0.1, 0.08, 0.2, 8),
                standard(thatch)
            );
            basket.position.y = 0.1;
            group.add(basket);
            break;
        }
        case 'hanging-lantern': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6),
                standard(wood)
            );
            post.position.y = 0.3;
            const lantern = new THREE.Mesh(
                new THREE.SphereGeometry(0.08, 8, 8),
                new THREE.MeshStandardMaterial({
                    color: new THREE.Color('#ffcc66'),
                    emissive: new THREE.Color('#ffcc66'),
                    emissiveIntensity: 0.85,
                    flatShading: true
                })
            );
            lantern.position.y = 0.68;
            group.add(post, lantern);
            break;
        }
        case 'plantain-patch': {
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.06, 0.32, 6),
                standard(jungleGreen)
            );
            trunk.position.y = 0.16;
            const leaves = new THREE.Mesh(
                new THREE.IcosahedronGeometry(0.22, 0),
                standard(jungleGreen)
            );
            leaves.position.y = 0.44;
            group.add(trunk, leaves);
            break;
        }
        case 'radio-dish': {
            const mast = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6),
                standard(new THREE.Color('#888888'))
            );
            mast.position.y = 0.35;
            const dish = new THREE.Mesh(
                new THREE.ConeGeometry(0.16, 0.12, 10),
                standard(new THREE.Color('#aaaaaa'))
            );
            dish.rotation.x = Math.PI;
            dish.position.y = 0.78;
            group.add(mast, dish);
            break;
        }
        case 'river-bird': {
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.14, 0.08, 0.08),
                standard(brightRed)
            );
            body.position.y = 0.25;
            const wing = new THREE.Mesh(
                new THREE.BoxGeometry(0.22, 0.03, 0.1),
                standard(brightRed)
            );
            wing.position.y = 0.27;
            group.add(body, wing);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(riverBrown)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    void fireOrange;
    return group;
}

const amazonRiverVillageRenderer: BiomeRenderer = {
    tilePaletteIndex: id => AMAZON_RIVER_VILLAGE_TILE_SLOT[id] ?? 0,
    buildProp: amazonRiverVillageProp
};

// ---------------------------------------------------------------------------
// Ancient Acropolis
// ---------------------------------------------------------------------------

// palette: limestone[0], aged-marble[1], ruin-gray[2], olive-green[3],
//          terracotta[4], sun-white[5], shadow-blue[6], gold-light[7]

const ANCIENT_ACROPOLIS_TILE_SLOT: Record<string, number> = {
    'dry-moat': 2,
    'rubble-slope': 1,
    'marble-court': 0,
    'procession-way': 5,
    'olive-court': 3,
    'column-row': 5,
    'broken-wall': 2,
    'altar-platform': 7,
    'temple-roof': 1,
    'oracle-hill': 6
};

function ancientAcropolisProp(
    propId: string,
    palette: THREE.Color[]
): THREE.Object3D {
    const group = new THREE.Group();
    const limestone = palette[0] ?? new THREE.Color('#f2e8cf');
    const agedMarble = palette[1] ?? new THREE.Color('#d6c7a1');
    const ruinGray = palette[2] ?? new THREE.Color('#8b7d6b');
    const oliveGreen = palette[3] ?? new THREE.Color('#6f8f3f');
    const terracotta = palette[4] ?? new THREE.Color('#c47a3c');
    const goldLight = palette[7] ?? new THREE.Color('#e6b85c');

    switch (propId) {
        case 'broken-column': {
            const shaft = new THREE.Mesh(
                new THREE.CylinderGeometry(0.09, 0.1, 0.55, 8),
                standard(agedMarble)
            );
            shaft.position.y = 0.275;
            const cap = new THREE.Mesh(
                new THREE.BoxGeometry(0.22, 0.08, 0.22),
                standard(limestone)
            );
            cap.position.y = 0.58;
            group.add(shaft, cap);
            break;
        }
        case 'olive-tree': {
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.055, 0.075, 0.45, 6),
                standard(ruinGray)
            );
            trunk.position.y = 0.225;
            const leaves = new THREE.Mesh(
                new THREE.IcosahedronGeometry(0.3, 0),
                standard(oliveGreen)
            );
            leaves.position.y = 0.58;
            group.add(trunk, leaves);
            break;
        }
        case 'bronze-brazier': {
            const stand = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.06, 0.32, 6),
                standard(ruinGray)
            );
            stand.position.y = 0.16;
            const bowl = new THREE.Mesh(
                new THREE.CylinderGeometry(0.1, 0.06, 0.1, 8),
                standard(new THREE.Color('#b8860b'))
            );
            bowl.position.y = 0.37;
            const flame = new THREE.Mesh(
                new THREE.SphereGeometry(0.08, 8, 8),
                new THREE.MeshStandardMaterial({
                    color: goldLight,
                    emissive: new THREE.Color('#ffaa33'),
                    emissiveIntensity: 0.9,
                    flatShading: true
                })
            );
            flame.position.y = 0.5;
            group.add(stand, bowl, flame);
            break;
        }
        case 'statue-fragment': {
            const torso = new THREE.Mesh(
                new THREE.BoxGeometry(0.14, 0.28, 0.1),
                standard(limestone)
            );
            torso.position.y = 0.2;
            torso.rotation.z = 0.15;
            group.add(torso);
            break;
        }
        case 'laurel-wreath': {
            const ring = new THREE.Mesh(
                new THREE.CylinderGeometry(0.14, 0.14, 0.04, 12, 1, true),
                standard(oliveGreen)
            );
            ring.position.y = 0.02;
            group.add(ring);
            break;
        }
        case 'eagle': {
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.12, 0.1, 0.1),
                standard(terracotta)
            );
            body.position.y = 0.45;
            const wings = new THREE.Mesh(
                new THREE.BoxGeometry(0.38, 0.04, 0.1),
                standard(terracotta)
            );
            wings.position.y = 0.46;
            group.add(body, wings);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(agedMarble)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    return group;
}

const ancientAcropolisRenderer: BiomeRenderer = {
    tilePaletteIndex: id => ANCIENT_ACROPOLIS_TILE_SLOT[id] ?? 0,
    buildProp: ancientAcropolisProp
};

// ---------------------------------------------------------------------------
// Ocean Reef
// ---------------------------------------------------------------------------

// palette: deep-blue[0], reef-blue[1], lagoon-cyan[2], sand[3],
//          coral-pink[4], coral-gold[5], seagrass[6], caustic-white[7]

const OCEAN_REEF_TILE_SLOT: Record<string, number> = {
    'deep-water': 0,
    'lagoon-edge': 1,
    'sand-channel': 3,
    'seagrass-bed': 6,
    'coral-garden': 4,
    'reef-shelf': 5,
    'kelp-arch': 6,
    'anemone-field': 4,
    'coral-tower': 5,
    'light-spire': 7
};

function oceanReefProp(propId: string, palette: THREE.Color[]): THREE.Object3D {
    const group = new THREE.Group();
    const deepBlue = palette[0] ?? new THREE.Color('#003f5c');
    const coralPink = palette[4] ?? new THREE.Color('#ff8fab');
    const coralGold = palette[5] ?? new THREE.Color('#ffcf56');
    const seagrass = palette[6] ?? new THREE.Color('#2a9d8f');
    const causticWhite = palette[7] ?? new THREE.Color('#f8f9fa');
    const bioCyan = new THREE.Color('#00ffe0');

    switch (propId) {
        case 'fish-school': {
            for (let i = 0; i < 4; i++) {
                const fish = new THREE.Mesh(
                    new THREE.BoxGeometry(0.1, 0.04, 0.06),
                    standard(coralGold)
                );
                fish.position.set(
                    (i - 1.5) * 0.12,
                    0.3 + i * 0.04,
                    (i % 2) * 0.08
                );
                group.add(fish);
            }
            break;
        }
        case 'sea-turtle': {
            const shell = new THREE.Mesh(
                new THREE.BoxGeometry(0.28, 0.08, 0.22),
                standard(seagrass)
            );
            shell.position.y = 0.1;
            const head = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 0.06, 0.08),
                standard(new THREE.Color('#3a7a3a'))
            );
            head.position.set(0.16, 0.1, 0);
            group.add(shell, head);
            break;
        }
        case 'bubble-column': {
            for (let i = 0; i < 5; i++) {
                const bubble = new THREE.Mesh(
                    new THREE.SphereGeometry(0.03 + i * 0.01, 6, 6),
                    new THREE.MeshStandardMaterial({
                        color: bioCyan,
                        emissive: bioCyan,
                        emissiveIntensity: 0.6,
                        transparent: true,
                        opacity: 0.7,
                        flatShading: true
                    })
                );
                bubble.position.set(
                    i % 2 === 0 ? 0.03 : -0.03,
                    i * 0.12 + 0.05,
                    0
                );
                group.add(bubble);
            }
            break;
        }
        case 'shell-cluster': {
            for (let i = 0; i < 3; i++) {
                const shell = new THREE.Mesh(
                    new THREE.SphereGeometry(0.07, 6, 6),
                    standard(causticWhite)
                );
                shell.position.set((i - 1) * 0.12, 0.07, (i % 2) * 0.08);
                group.add(shell);
            }
            break;
        }
        case 'ray-shadow': {
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.36, 0.04, 0.28),
                standard(deepBlue)
            );
            body.position.y = 0.25;
            const tail = new THREE.Mesh(
                new THREE.BoxGeometry(0.04, 0.03, 0.22),
                standard(deepBlue)
            );
            tail.position.set(-0.18, 0.25, 0);
            group.add(body, tail);
            break;
        }
        case 'soft-coral': {
            const base = new THREE.Mesh(
                new THREE.CylinderGeometry(0.05, 0.07, 0.15, 6),
                standard(coralPink)
            );
            base.position.y = 0.075;
            const branchV = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.035, 0.28, 6),
                standard(coralPink)
            );
            branchV.position.y = 0.29;
            const branchL = new THREE.Mesh(
                new THREE.CylinderGeometry(0.018, 0.025, 0.2, 6),
                standard(coralPink)
            );
            branchL.position.set(-0.1, 0.3, 0);
            branchL.rotation.z = 0.5;
            const branchR = branchL.clone();
            branchR.position.x = 0.1;
            branchR.rotation.z = -0.5;
            group.add(base, branchV, branchL, branchR);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(coralPink)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    return group;
}

const oceanReefRenderer: BiomeRenderer = {
    tilePaletteIndex: id => OCEAN_REEF_TILE_SLOT[id] ?? 0,
    buildProp: oceanReefProp
};

// ---------------------------------------------------------------------------
// West African Savanna
// ---------------------------------------------------------------------------

// palette: gold-grass[0], red-earth[1], baobab-bark[2], leaf-green[3],
//          thatch[4], clay-red[5], deep-shadow[6], sunset-gold[7]

const WEST_AFRICAN_SAVANNA_TILE_SLOT: Record<string, number> = {
    'dry-riverbed': 6,
    'dust-edge': 1,
    'gold-grass': 0,
    'red-path': 1,
    'shade-court': 4,
    'baobab-grove': 2,
    'clay-compound': 5,
    'market-shelter': 4,
    'drum-tower': 7,
    'sunset-ridge': 0
};

function westAfricanSavannaProp(
    propId: string,
    palette: THREE.Color[]
): THREE.Object3D {
    const group = new THREE.Group();
    const goldGrass = palette[0] ?? new THREE.Color('#d9a441');
    const redEarth = palette[1] ?? new THREE.Color('#b85c2e');
    const baobabBark = palette[2] ?? new THREE.Color('#7a4a24');
    const leafGreen = palette[3] ?? new THREE.Color('#5e8c31');
    const thatch = palette[4] ?? new THREE.Color('#f2d28b');
    const clayRed = palette[5] ?? new THREE.Color('#8b2f23');
    const sunsetGold = palette[7] ?? new THREE.Color('#ffcc5c');

    switch (propId) {
        case 'baobab-tree': {
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.14, 0.18, 0.42, 8),
                standard(baobabBark)
            );
            trunk.position.y = 0.21;
            const canopy = new THREE.Mesh(
                new THREE.IcosahedronGeometry(0.38, 0),
                standard(leafGreen)
            );
            canopy.position.y = 0.63;
            group.add(trunk, canopy);
            break;
        }
        case 'kora-player': {
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.1, 0.22, 0.08),
                standard(redEarth)
            );
            body.position.y = 0.17;
            const head = new THREE.Mesh(
                new THREE.SphereGeometry(0.07, 8, 8),
                standard(redEarth)
            );
            head.position.y = 0.35;
            const gourd = new THREE.Mesh(
                new THREE.SphereGeometry(0.09, 8, 8),
                standard(baobabBark)
            );
            gourd.position.set(0.12, 0.22, 0);
            group.add(body, head, gourd);
            break;
        }
        case 'djembe': {
            const drum = new THREE.Mesh(
                new THREE.CylinderGeometry(0.1, 0.07, 0.3, 8),
                standard(baobabBark)
            );
            drum.position.y = 0.15;
            group.add(drum);
            break;
        }
        case 'woven-basket': {
            const basket = new THREE.Mesh(
                new THREE.CylinderGeometry(0.14, 0.1, 0.18, 8),
                standard(thatch)
            );
            basket.position.y = 0.09;
            group.add(basket);
            break;
        }
        case 'goat': {
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.22, 0.14, 0.1),
                standard(thatch)
            );
            body.position.y = 0.14;
            const head = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 0.09, 0.08),
                standard(thatch)
            );
            head.position.set(0.13, 0.22, 0);
            group.add(body, head);
            break;
        }
        case 'sun-banner': {
            const pole = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.02, 0.75, 6),
                standard(baobabBark)
            );
            pole.position.y = 0.375;
            const banner = new THREE.Mesh(
                new THREE.BoxGeometry(0.28, 0.2, 0.02),
                standard(sunsetGold)
            );
            banner.position.set(0.15, 0.68, 0);
            group.add(pole, banner);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(goldGrass)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    void clayRed;
    return group;
}

const westAfricanSavannaRenderer: BiomeRenderer = {
    tilePaletteIndex: id => WEST_AFRICAN_SAVANNA_TILE_SLOT[id] ?? 0,
    buildProp: westAfricanSavannaProp
};

// ---------------------------------------------------------------------------
// Polynesian Atoll
// ---------------------------------------------------------------------------

// palette: lagoon-blue[0], reef-mint[1], coral-sand[2], pandanus-green[3],
//          thatch-wood[4], lava-black[5], shell-white[6], sunset-orange[7]

const POLYNESIAN_ATOLL_TILE_SLOT: Record<string, number> = {
    'lagoon-water': 0,
    'reef-ring': 1,
    'coral-sand': 2,
    'pandanus-grove': 3,
    'shell-path': 6,
    'fale-hut': 4,
    'canoe-dock': 4,
    'lava-rock': 5,
    'totem-mast': 7,
    'volcanic-crown': 5
};

function polynesianAtollProp(
    propId: string,
    palette: THREE.Color[]
): THREE.Object3D {
    const group = new THREE.Group();
    const lagoonBlue = palette[0] ?? new THREE.Color('#00a8c8');
    const reefMint = palette[1] ?? new THREE.Color('#7ee8d4');
    const pandanusGreen = palette[3] ?? new THREE.Color('#2f8f5b');
    const thatchWood = palette[4] ?? new THREE.Color('#9b5d2e');
    const lavaBlack = palette[5] ?? new THREE.Color('#333333');
    const shellWhite = palette[6] ?? new THREE.Color('#f2f0e6');
    const sunsetOrange = palette[7] ?? new THREE.Color('#ffb84d');
    const warmYellow = new THREE.Color('#ffe08a');

    switch (propId) {
        case 'outrigger-canoe': {
            const hull = new THREE.Mesh(
                new THREE.BoxGeometry(0.55, 0.08, 0.16),
                standard(thatchWood)
            );
            hull.position.y = 0.04;
            const float = new THREE.Mesh(
                new THREE.BoxGeometry(0.45, 0.04, 0.06),
                standard(thatchWood)
            );
            float.position.set(0, 0.04, 0.2);
            group.add(hull, float);
            break;
        }
        case 'ukulele-seat': {
            const seat = new THREE.Mesh(
                new THREE.BoxGeometry(0.28, 0.05, 0.2),
                standard(thatchWood)
            );
            seat.position.y = 0.2;
            const uke = new THREE.Mesh(
                new THREE.BoxGeometry(0.04, 0.22, 0.1),
                standard(new THREE.Color('#b87040'))
            );
            uke.position.set(0.12, 0.32, 0);
            group.add(seat, uke);
            break;
        }
        case 'flower-lei': {
            for (let i = 0; i < 6; i++) {
                const angle = (i / 6) * Math.PI * 2;
                const petal = new THREE.Mesh(
                    new THREE.SphereGeometry(0.05, 6, 6),
                    standard(i % 2 === 0 ? sunsetOrange : reefMint)
                );
                petal.position.set(
                    Math.cos(angle) * 0.13,
                    0.08,
                    Math.sin(angle) * 0.13
                );
                group.add(petal);
            }
            break;
        }
        case 'tiki-torch': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.03, 0.72, 6),
                standard(thatchWood)
            );
            post.position.y = 0.36;
            const ember = new THREE.Mesh(
                new THREE.SphereGeometry(0.07, 8, 8),
                new THREE.MeshStandardMaterial({
                    color: warmYellow,
                    emissive: warmYellow,
                    emissiveIntensity: 0.9,
                    flatShading: true
                })
            );
            ember.position.y = 0.78;
            group.add(post, ember);
            break;
        }
        case 'crab': {
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.16, 0.06, 0.12),
                standard(sunsetOrange)
            );
            body.position.y = 0.05;
            const clawL = new THREE.Mesh(
                new THREE.BoxGeometry(0.06, 0.04, 0.04),
                standard(sunsetOrange)
            );
            clawL.position.set(-0.12, 0.06, 0);
            const clawR = clawL.clone();
            clawR.position.x = 0.12;
            group.add(body, clawL, clawR);
            break;
        }
        case 'surfboard': {
            const board = new THREE.Mesh(
                new THREE.BoxGeometry(0.12, 0.04, 0.48),
                standard(lagoonBlue)
            );
            board.position.y = 0.02;
            group.add(board);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(shellWhite)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    void lavaBlack;
    void pandanusGreen;
    return group;
}

const polynesianAtollRenderer: BiomeRenderer = {
    tilePaletteIndex: id => POLYNESIAN_ATOLL_TILE_SLOT[id] ?? 0,
    buildProp: polynesianAtollProp
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, BiomeRenderer>([
    ['mykonos', mykonosRenderer],
    ['cyberpunk', cyberpunkRenderer],
    ['cuban-beach', cubanBeachRenderer],
    ['rave-festival', raveFestivalRenderer],
    ['solarpunk', solarpunkRenderer],
    ['bollywood-ghats', bollywoodGhatsRenderer],
    ['tobacco-plantation', tobaccoPlantationRenderer],
    ['spanish-colonial', spanishColonialRenderer],
    ['jazz-quarter', jazzQuarterRenderer],
    ['nordic-fjord', nordicFjordRenderer],
    ['tokyo-city-pop', tokyoCityPopRenderer],
    ['desert-oasis', desertOasisRenderer],
    ['rio-carnival', rioCarnivalRenderer],
    ['jungle-canopy', jungleCanopyRenderer],
    ['arctic-base', arcticBaseRenderer],
    ['amazon-river-village', amazonRiverVillageRenderer],
    ['ancient-acropolis', ancientAcropolisRenderer],
    ['ocean-reef', oceanReefRenderer],
    ['west-african-savanna', westAfricanSavannaRenderer],
    ['polynesian-atoll', polynesianAtollRenderer]
]);

export function registerBiomeRenderer(
    id: string,
    renderer: BiomeRenderer
): void {
    registry.set(id, renderer);
}

/** Resolve a biome's renderer, falling back to Mykonos for unknown biomes. */
export function getBiomeRenderer(id: string): BiomeRenderer {
    return registry.get(id) ?? mykonosRenderer;
}
