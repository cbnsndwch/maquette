import * as THREE from 'three';

import type { Voxel } from './voxel.mjs';

/**
 * Turns a procedural {@link Voxel} list into a single smooth, lit surface mesh —
 * the alternative to {@link VoxelBatch}'s flat instanced cubes. Instead of
 * drawing one cube per voxel, the voxels are treated as a 3D occupancy field and
 * a smooth isosurface is pulled out of it (naive **surface nets**), so an olive
 * canopy reads as a rounded blob and a trunk as a tapered column rather than a
 * stack of boxes. Each voxel's color is carried onto the nearest output vertices
 * as vertex colors; the result is a real `BufferGeometry` with normals that takes
 * scene lighting and casts shadows.
 *
 * World mapping matches {@link VoxelBatch}: voxel x→X, z→Y (up), y→Z, with the
 * surface aligned to the same cell bounds the cubes would occupy.
 */
export interface VoxelMeshOptions {
    /** World size of one voxel cell. Default 1. */
    size?: number;
    /**
     * Laplacian smoothing iterations applied to the extracted surface. Higher =
     * rounder / more organic, lower = closer to the blocky silhouette. Default 4.
     */
    smooth?: number;
    /** Relaxation factor per smoothing pass, 0..1. Default 0.5. */
    smoothFactor?: number;
    /**
     * Box-blur passes applied to the occupancy field before extraction. 0 keeps
     * thin features (1-wide trunks); >0 inflates the field into blobbier forms
     * but can erase thin parts. Default 0.
     */
    blur?: number;
    /** PBR roughness of the generated material. Default 0.85. */
    roughness?: number;
    /** Faceted (low-poly) look instead of smooth normals. Default false. */
    flatShading?: boolean;
}

// ── Surface Nets lookup tables (built once) ─────────────────────────────────
// Naive Surface Nets after S.F. Gibson / Mikola Lysenko. `cubeEdges` lists the
// 12 edges of a cube as pairs of corner indices; `edgeTable[mask]` gives, for a
// given inside/outside corner mask, which edges the surface crosses.
const cubeEdges = new Int32Array(24);
const edgeTable = new Int32Array(256);
(function initTables() {
    let k = 0;
    for (let i = 0; i < 8; i++) {
        for (let j = 1; j <= 4; j <<= 1) {
            const p = i ^ j;
            if (i <= p) {
                cubeEdges[k++] = i;
                cubeEdges[k++] = p;
            }
        }
    }
    for (let i = 0; i < 256; i++) {
        let em = 0;
        for (let j = 0; j < 24; j += 2) {
            const a = !!(i & (1 << cubeEdges[j]!));
            const b = !!(i & (1 << cubeEdges[j + 1]!));
            em |= a !== b ? 1 << (j >> 1) : 0;
        }
        edgeTable[i] = em;
    }
})();

interface SurfaceNetsResult {
    /** Flat vertex positions in field-sample space (x,y,z per vertex). */
    positions: Float32Array;
    /** Quad faces, 4 vertex indices each. */
    quads: Int32Array;
    quadCount: number;
}

/**
 * Extract a dual surface from a scalar `field` (negative = inside) sized
 * `nx×ny×nz`, indexed `x + nx*(y + ny*z)`. One vertex per surface-straddling
 * cell, placed at the centroid of its edge crossings.
 */
function surfaceNets(
    field: Float32Array,
    nx: number,
    ny: number,
    nz: number
): SurfaceNetsResult {
    const positions: number[] = [];
    const quads: number[] = [];
    const dims = [nx, ny, nz];
    const R = [1, nx + 1, (nx + 1) * (ny + 1)];
    const buffer = new Int32Array(R[2]! * 2);
    const grid = new Float32Array(8);
    const x = [0, 0, 0];
    let bufNo = 1;
    let n = 0;

    for (x[2] = 0; x[2]! < dims[2]! - 1; x[2]!++, n += nx, bufNo ^= 1, R[2] = -R[2]!) {
        let m = 1 + (nx + 1) * (1 + bufNo * (ny + 1));
        for (x[1] = 0; x[1]! < dims[1]! - 1; x[1]!++, n++, m += 2) {
            for (x[0] = 0; x[0]! < dims[0]! - 1; x[0]!++, n++, m++) {
                // Read the 8 corners of this cell, build the inside/outside mask.
                let mask = 0;
                let g = 0;
                let idx = n;
                for (let k = 0; k < 2; k++, idx += nx * (ny - 2)) {
                    for (let j = 0; j < 2; j++, idx += nx - 2) {
                        for (let i = 0; i < 2; i++, g++, idx++) {
                            const p = field[idx]!;
                            grid[g] = p;
                            mask |= p < 0 ? 1 << g : 0;
                        }
                    }
                }
                if (mask === 0 || mask === 0xff) continue;

                const edgeMask = edgeTable[mask]!;
                const v = [0, 0, 0];
                let eCount = 0;
                for (let i = 0; i < 12; i++) {
                    if (!(edgeMask & (1 << i))) continue;
                    eCount++;
                    const e0 = cubeEdges[i << 1]!;
                    const e1 = cubeEdges[(i << 1) + 1]!;
                    const g0 = grid[e0]!;
                    const g1 = grid[e1]!;
                    let t = g0 - g1;
                    if (Math.abs(t) > 1e-6) t = g0 / t;
                    else continue;
                    for (let j = 0, kk = 1; j < 3; j++, kk <<= 1) {
                        const a = e0 & kk;
                        const b = e1 & kk;
                        if (a !== b) v[j]! += a ? 1 - t : t;
                        else v[j]! += a ? 1 : 0;
                    }
                }
                const s = 1 / eCount;
                for (let i = 0; i < 3; i++) v[i] = x[i]! + s * v[i]!;

                buffer[m] = positions.length / 3;
                positions.push(v[0]!, v[1]!, v[2]!);

                // Emit a quad for each of the 3 axis-aligned edges that the
                // surface crosses at this cell's minimum corner.
                for (let i = 0; i < 3; i++) {
                    if (!(edgeMask & (1 << i))) continue;
                    const iu = (i + 1) % 3;
                    const iv = (i + 2) % 3;
                    if (x[iu] === 0 || x[iv] === 0) continue;
                    const du = R[iu]!;
                    const dv = R[iv]!;
                    if (mask & 1) {
                        quads.push(buffer[m]!, buffer[m - du]!, buffer[m - du - dv]!, buffer[m - dv]!);
                    } else {
                        quads.push(buffer[m]!, buffer[m - dv]!, buffer[m - du - dv]!, buffer[m - du]!);
                    }
                }
            }
        }
    }

    return {
        positions: new Float32Array(positions),
        quads: new Int32Array(quads),
        quadCount: quads.length / 4
    };
}

/** Inclusive integer bounds of a voxel list. */
function bounds(voxels: readonly Voxel[]) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const v of voxels) {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.z < minZ) minZ = v.z;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
        if (v.z > maxZ) maxZ = v.z;
    }
    return { minX, minY, minZ, maxX, maxY, maxZ };
}

/** Separable 3-tap [1,2,1]/4 box blur of a scalar field, `passes` times. */
function blurField(
    field: Float32Array,
    nx: number,
    ny: number,
    nz: number,
    passes: number
): Float32Array {
    let src = field;
    const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
    for (let p = 0; p < passes; p++) {
        const dst = new Float32Array(src.length);
        for (let z = 0; z < nz; z++)
            for (let y = 0; y < ny; y++)
                for (let x = 0; x < nx; x++) {
                    const c = src[at(x, y, z)]!;
                    const xl = x > 0 ? src[at(x - 1, y, z)]! : c;
                    const xr = x < nx - 1 ? src[at(x + 1, y, z)]! : c;
                    const yl = y > 0 ? src[at(x, y - 1, z)]! : c;
                    const yr = y < ny - 1 ? src[at(x, y + 1, z)]! : c;
                    const zl = z > 0 ? src[at(x, y, z - 1)]! : c;
                    const zr = z < nz - 1 ? src[at(x, y, z + 1)]! : c;
                    dst[at(x, y, z)] = (6 * c + xl + xr + yl + yr + zl + zr) / 12;
                }
        src = dst;
    }
    return src;
}

/**
 * Build a smooth, lit {@link THREE.Mesh} from a voxel list via surface nets.
 * Returns an empty mesh for an empty input.
 */
export function voxelsToSmoothMesh(
    voxels: readonly Voxel[],
    opts: VoxelMeshOptions = {}
): THREE.Mesh {
    const {
        size = 1,
        smooth = 4,
        smoothFactor = 0.5,
        blur = 0,
        roughness = 0.85,
        flatShading = false
    } = opts;

    const geometry = voxelsToSmoothGeometry(voxels, { size, smooth, smoothFactor, blur });
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness,
        metalness: 0,
        flatShading
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'voxel-smooth';
    return mesh;
}

/**
 * The geometry half of {@link voxelsToSmoothMesh} — a `BufferGeometry` with
 * position, per-voxel-color, and normal attributes, already triangulated.
 */
export function voxelsToSmoothGeometry(
    voxels: readonly Voxel[],
    opts: Pick<VoxelMeshOptions, 'size' | 'smooth' | 'smoothFactor' | 'blur'> = {}
): THREE.BufferGeometry {
    const { size = 1, smooth = 4, smoothFactor = 0.5, blur = 0 } = opts;
    const geometry = new THREE.BufferGeometry();
    if (voxels.length === 0) return geometry;

    const pad = 2;
    const b = bounds(voxels);
    const originX = b.minX - pad;
    const originY = b.minY - pad;
    const originZ = b.minZ - pad;
    const nx = b.maxX - b.minX + 1 + 2 * pad;
    const ny = b.maxY - b.minY + 1 + 2 * pad;
    const nz = b.maxZ - b.minZ + 1 + 2 * pad;

    // Occupancy field (1 inside), plus a parallel color lookup keyed by sample.
    const occ = new Float32Array(nx * ny * nz);
    const colorAt = new Map<number, string>();
    const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);
    for (const v of voxels) {
        const i = at(v.x - originX, v.y - originY, v.z - originZ);
        occ[i] = 1;
        colorAt.set(i, v.c);
    }

    const density = blur > 0 ? blurField(occ, nx, ny, nz, blur) : occ;
    // Surface nets wants negative-inside; cross the field at the 0.5 isolevel.
    const field = new Float32Array(density.length);
    for (let i = 0; i < density.length; i++) field[i] = 0.5 - density[i]!;

    const { positions, quads, quadCount } = surfaceNets(field, nx, ny, nz);
    const vertCount = positions.length / 3;
    if (vertCount === 0) return geometry;

    // Per-vertex color: nearest occupied sample to the (continuous) vertex.
    const colors = new Float32Array(vertCount * 3);
    const col = new THREE.Color();
    for (let i = 0; i < vertCount; i++) {
        const gx = positions[i * 3]!;
        const gy = positions[i * 3 + 1]!;
        const gz = positions[i * 3 + 2]!;
        const hex = nearestColor(gx, gy, gz, colorAt, at, nx, ny, nz);
        col.set(hex).convertSRGBToLinear();
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
    }

    // Map field-sample space → world space (matches VoxelBatch cell bounds).
    const world = new Float32Array(positions.length);
    for (let i = 0; i < vertCount; i++) {
        const ax = originX + positions[i * 3]!;
        const ay = originY + positions[i * 3 + 1]!;
        const az = originZ + positions[i * 3 + 2]!;
        world[i * 3] = (ax + 0.5) * size;
        world[i * 3 + 1] = (az + 0.5) * size; // z up
        world[i * 3 + 2] = (ay + 0.5) * size;
    }

    if (smooth > 0) laplacianSmooth(world, quads, quadCount, smooth, smoothFactor);

    // Triangulate quads (a,b,c,d) → (a,b,c) + (a,c,d).
    const indices = new Uint32Array(quadCount * 6);
    for (let q = 0; q < quadCount; q++) {
        const a = quads[q * 4]!;
        const bb = quads[q * 4 + 1]!;
        const c = quads[q * 4 + 2]!;
        const d = quads[q * 4 + 3]!;
        const o = q * 6;
        indices[o] = a; indices[o + 1] = bb; indices[o + 2] = c;
        indices[o + 3] = a; indices[o + 4] = c; indices[o + 5] = d;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(world, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    return geometry;
}

/** Nearest occupied sample's color, searching outward up to `pad` cells. */
function nearestColor(
    gx: number,
    gy: number,
    gz: number,
    colorAt: Map<number, string>,
    at: (x: number, y: number, z: number) => number,
    nx: number,
    ny: number,
    nz: number
): string {
    const cx = Math.round(gx);
    const cy = Math.round(gy);
    const cz = Math.round(gz);
    let best = '#b0b0b0';
    let bestD = Infinity;
    for (let dz = -2; dz <= 2; dz++)
        for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
                const x = cx + dx;
                const y = cy + dy;
                const z = cz + dz;
                if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
                const hex = colorAt.get(at(x, y, z));
                if (hex === undefined) continue;
                const d = (x - gx) ** 2 + (y - gy) ** 2 + (z - gz) ** 2;
                if (d < bestD) {
                    bestD = d;
                    best = hex;
                }
            }
    return best;
}

/** In-place Laplacian smoothing of vertex positions over the quad mesh. */
function laplacianSmooth(
    pos: Float32Array,
    quads: Int32Array,
    quadCount: number,
    iterations: number,
    factor: number
): void {
    const vertCount = pos.length / 3;
    const neighbors: Set<number>[] = Array.from({ length: vertCount }, () => new Set());
    const edge = (a: number, c: number) => {
        neighbors[a]!.add(c);
        neighbors[c]!.add(a);
    };
    for (let q = 0; q < quadCount; q++) {
        const a = quads[q * 4]!;
        const b = quads[q * 4 + 1]!;
        const c = quads[q * 4 + 2]!;
        const d = quads[q * 4 + 3]!;
        edge(a, b); edge(b, c); edge(c, d); edge(d, a);
    }

    for (let it = 0; it < iterations; it++) {
        const next = new Float32Array(pos.length);
        for (let i = 0; i < vertCount; i++) {
            const ns = neighbors[i]!;
            if (ns.size === 0) {
                next[i * 3] = pos[i * 3]!;
                next[i * 3 + 1] = pos[i * 3 + 1]!;
                next[i * 3 + 2] = pos[i * 3 + 2]!;
                continue;
            }
            let sx = 0, sy = 0, sz = 0;
            for (const j of ns) {
                sx += pos[j * 3]!;
                sy += pos[j * 3 + 1]!;
                sz += pos[j * 3 + 2]!;
            }
            const inv = 1 / ns.size;
            next[i * 3] = pos[i * 3]! + factor * (sx * inv - pos[i * 3]!);
            next[i * 3 + 1] = pos[i * 3 + 1]! + factor * (sy * inv - pos[i * 3 + 1]!);
            next[i * 3 + 2] = pos[i * 3 + 2]! + factor * (sz * inv - pos[i * 3 + 2]!);
        }
        pos.set(next);
    }
}
