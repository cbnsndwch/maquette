import * as THREE from 'three';

/**
 * A tiny voxel vocabulary for biome rendering. Biomes compose primitives into
 * local voxel lists (sub-tile surface patterns, multi-voxel props); a
 * {@link VoxelBatch} bakes them into world space and emits one InstancedMesh per
 * color, so a town's worth of cubes stays a handful of draw calls.
 *
 * Coordinates are integer voxel cells: `x`/`y` lie on the ground plane, `z` is
 * up. (Ported from the mykonos-voxels reference's `box`/`shell`/`dome`/… set.)
 */
export interface Voxel {
    x: number;
    y: number;
    z: number;
    /** Hex color, e.g. '#fafaf5'. */
    c: string;
}

/** Solid filled box of `w×d×h` voxels with its near-bottom corner at x,y,z. */
export function box(
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    h: number,
    c: string
): Voxel[] {
    const out: Voxel[] = [];
    for (let ix = 0; ix < w; ix++) {
        for (let iy = 0; iy < d; iy++) {
            for (let iz = 0; iz < h; iz++) {
                out.push({ x: x + ix, y: y + iy, z: z + iz, c });
            }
        }
    }
    return out;
}

export interface ShellOptions {
    floor?: boolean;
    roof?: boolean;
    sides?: boolean;
}

/** Hollow box: walls (and optionally floor/roof) only. */
export function shell(
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    h: number,
    c: string,
    opts: ShellOptions = {}
): Voxel[] {
    const { floor = false, roof = false, sides = true } = opts;
    const out: Voxel[] = [];
    for (let ix = 0; ix < w; ix++) {
        for (let iy = 0; iy < d; iy++) {
            for (let iz = 0; iz < h; iz++) {
                const onBottom = iz === 0;
                const onTop = iz === h - 1;
                const onSide =
                    ix === 0 || ix === w - 1 || iy === 0 || iy === d - 1;
                if (
                    (sides && onSide) ||
                    (floor && onBottom) ||
                    (roof && onTop)
                ) {
                    out.push({ x: x + ix, y: y + iy, z: z + iz, c });
                }
            }
        }
    }
    return out;
}

/** Stepped pyramid roof: each layer insets by one voxel for `h` layers. */
export function pyramidRoof(
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    h: number,
    c: string
): Voxel[] {
    const out: Voxel[] = [];
    for (let iz = 0; iz < h; iz++) {
        const inset = iz;
        const w2 = w - 2 * inset;
        const d2 = d - 2 * inset;
        if (w2 <= 0 || d2 <= 0) break;
        for (let ix = 0; ix < w2; ix++) {
            for (let iy = 0; iy < d2; iy++) {
                out.push({
                    x: x + inset + ix,
                    y: y + inset + iy,
                    z: z + iz,
                    c
                });
            }
        }
    }
    return out;
}

/** Rounded dome of integer `radius` centered at cx,cy, rising from z. */
export function dome(
    cx: number,
    cy: number,
    z: number,
    radius: number,
    c: string
): Voxel[] {
    const out: Voxel[] = [];
    for (let iz = 0; iz <= radius; iz++) {
        const lr = Math.max(0, Math.sqrt(radius * radius - iz * iz));
        const lrCeil = Math.round(lr);
        for (let ix = -lrCeil; ix <= lrCeil; ix++) {
            for (let iy = -lrCeil; iy <= lrCeil; iy++) {
                if (Math.sqrt(ix * ix + iy * iy) <= lr + 0.4) {
                    out.push({ x: cx + ix, y: cy + iy, z: z + iz, c });
                }
            }
        }
    }
    return out;
}

/** Vertical cylinder of integer `radius`, `h` tall, centered at cx,cy. */
export function cylinder(
    cx: number,
    cy: number,
    z: number,
    radius: number,
    h: number,
    c: string
): Voxel[] {
    const out: Voxel[] = [];
    for (let ix = -radius; ix <= radius; ix++) {
        for (let iy = -radius; iy <= radius; iy++) {
            if (ix * ix + iy * iy > radius * radius + 0.5) continue;
            for (let iz = 0; iz < h; iz++) {
                out.push({ x: cx + ix, y: cy + iy, z: z + iz, c });
            }
        }
    }
    return out;
}

/** Concatenate voxel arrays (ignoring empty ones). */
export function compose(...arrs: (Voxel[] | undefined)[]): Voxel[] {
    const out: Voxel[] = [];
    for (const a of arrs) {
        if (a) out.push(...a);
    }
    return out;
}

/**
 * Merge voxel arrays, de-duplicating by position so later layers overwrite
 * earlier ones (e.g. windows/doors painted onto walls). Avoids coincident
 * cubes, which would z-fight.
 */
export function mergeVoxels(...arrs: (Voxel[] | undefined)[]): Voxel[] {
    const at = new Map<string, Voxel>();
    for (const a of arrs) {
        if (!a) continue;
        for (const v of a) at.set(`${v.x},${v.y},${v.z}`, v);
    }
    return [...at.values()];
}

export interface VoxelPlacement {
    /** World-space position (units) of the voxel-local (0,0,0) corner. */
    origin: [number, number, number];
    /** Quarter-turns about the footprint's vertical axis. */
    rotation?: 0 | 1 | 2 | 3;
    /** Footprint width in voxels; defaults to the voxels' bounding box. */
    span?: number;
}

/**
 * Accumulates voxels from many placements and bakes them into instanced meshes,
 * grouped by color. World mapping: voxel x→X, z→Y (up), y→Z, each cube centered
 * in its cell.
 */
export class VoxelBatch {
    readonly #size: number;
    readonly #byColor = new Map<string, number[]>();

    constructor(voxelSize: number) {
        this.#size = voxelSize;
    }

    add(voxels: readonly Voxel[], placement: VoxelPlacement): void {
        if (voxels.length === 0) return;
        const [ox, oy, oz] = placement.origin;
        const rot = placement.rotation ?? 0;

        let span = placement.span ?? 0;
        if (rot !== 0 && span === 0) {
            for (const v of voxels) {
                span = Math.max(span, v.x + 1, v.y + 1);
            }
        }

        for (const v of voxels) {
            let vx = v.x;
            let vy = v.y;
            if (rot === 1) {
                vx = v.y;
                vy = span - 1 - v.x;
            } else if (rot === 2) {
                vx = span - 1 - v.x;
                vy = span - 1 - v.y;
            } else if (rot === 3) {
                vx = span - 1 - v.y;
                vy = v.x;
            }

            const arr = this.#byColor.get(v.c) ?? this.#newColor(v.c);
            arr.push(
                ox + (vx + 0.5) * this.#size,
                oy + (v.z + 0.5) * this.#size,
                oz + (vy + 0.5) * this.#size
            );
        }
    }

    #newColor(c: string): number[] {
        const arr: number[] = [];
        this.#byColor.set(c, arr);
        return arr;
    }

    /** Total voxels accumulated. */
    get count(): number {
        let n = 0;
        for (const arr of this.#byColor.values()) n += arr.length / 3;
        return n;
    }

    /**
     * Build one unlit InstancedMesh for all voxels. Each cube's faces carry a
     * baked greyscale shade (top brightest → bottom darkest), multiplied by the
     * per-instance base color — reproducing the reference rasterizer's flat
     * 3-face voxel shading with exact, lighting-independent colors.
     */
    build(): THREE.Group {
        const group = new THREE.Group();
        group.name = 'voxels';

        let total = 0;
        for (const arr of this.#byColor.values()) total += arr.length / 3;
        if (total === 0) return group;

        const mesh = new THREE.InstancedMesh(
            shadedBoxGeometry(this.#size),
            new THREE.MeshBasicMaterial({ vertexColors: true }),
            total
        );
        const matrix = new THREE.Matrix4();
        const color = new THREE.Color();
        let i = 0;
        for (const [hex, coords] of this.#byColor) {
            color.set(hex);
            for (let k = 0; k < coords.length; k += 3) {
                matrix.makeTranslation(
                    coords[k]!,
                    coords[k + 1]!,
                    coords[k + 2]!
                );
                mesh.setMatrixAt(i, matrix);
                mesh.setColorAt(i, color);
                i++;
            }
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        group.add(mesh);
        return group;
    }
}

// Per-face shade for a unit cube, baked as vertex colors. BoxGeometry face order
// is +X, -X, +Y(top), -Y(bottom), +Z, -Z (4 vertices each). Asymmetric side
// shades give the scene depth from any orbit angle; top stays full-bright so
// whites read pure white.
const FACE_SHADE = [0.74, 0.54, 1.0, 0.4, 0.64, 0.84] as const;

function shadedBoxGeometry(size: number): THREE.BufferGeometry {
    const geo = new THREE.BoxGeometry(size, size, size);
    const colors = new Float32Array(24 * 3);
    for (let f = 0; f < 6; f++) {
        const s = FACE_SHADE[f]!;
        for (let v = 0; v < 4; v++) {
            const o = (f * 4 + v) * 3;
            colors[o] = s;
            colors[o + 1] = s;
            colors[o + 2] = s;
        }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
}
