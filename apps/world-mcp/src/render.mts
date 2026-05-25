import type { Voxel } from '@cbnsndwch/world-core';

/**
 * Headless isometric preview renderer.
 *
 * Voxel art in a fixed dimetric view is 2D rasterization, not 3D rendering — so
 * this needs neither a browser/GPU nor native modules. It projects each voxel's
 * three camera-facing faces, occlusion-culls faces whose neighbour cell is
 * filled, fills them with the same top-bright/side-dark shading the live
 * renderer bakes, and PNG-encodes via the Web-standard CompressionStream. Every
 * API used (typed arrays, CompressionStream, DataView) exists in both Node 18+
 * and Cloudflare Workers, so the same code lifts to the Worker unchanged.
 */

const MAX_RESOLUTION = 1024;
const MIN_RESOLUTION = 64;
const PAD = 8;

/** Per-face brightness (top brightest), echoing the live VoxelBatch shading. */
const SHADE = { top: 1.0, right: 0.82, left: 0.62 } as const;

/** Projection basis (base units; scaled to fit). +x → right-down, +y → left-down, +z → up. */
const BX = 1;
const BY = 0.5;

function hexToRgb(hex: string): [number, number, number] {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
    const n = parseInt(h, 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
}

interface Raster {
    width: number;
    height: number;
    rgba: Uint8ClampedArray;
}

/** Rasterize a voxel list to an RGBA buffer in an isometric view. */
export function rasterizeVoxels(
    voxels: readonly Voxel[],
    resolution: number
): Raster {
    const res = Math.max(
        MIN_RESOLUTION,
        Math.min(MAX_RESOLUTION, Math.round(resolution))
    );
    const rgba = new Uint8ClampedArray(res * res * 4);
    if (voxels.length === 0) return { width: res, height: res, rgba };

    const occupied = new Set<string>();
    for (const v of voxels) occupied.add(key(v.x, v.y, v.z));

    // Fit: project the AABB's 8 corners (scale 1) to find the screen bounds.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let vMinX = Infinity;
    let vMinY = Infinity;
    let vMinZ = Infinity;
    let vMaxX = -Infinity;
    let vMaxY = -Infinity;
    let vMaxZ = -Infinity;
    for (const v of voxels) {
        if (v.x < vMinX) vMinX = v.x;
        if (v.y < vMinY) vMinY = v.y;
        if (v.z < vMinZ) vMinZ = v.z;
        if (v.x > vMaxX) vMaxX = v.x;
        if (v.y > vMaxY) vMaxY = v.y;
        if (v.z > vMaxZ) vMaxZ = v.z;
    }
    for (const cx of [vMinX, vMaxX + 1]) {
        for (const cy of [vMinY, vMaxY + 1]) {
            for (const cz of [vMinZ, vMaxZ + 1]) {
                const sx = (cx - cy) * BX;
                const sy = (cx + cy) * BY - cz;
                if (sx < minX) minX = sx;
                if (sy < minY) minY = sy;
                if (sx > maxX) maxX = sx;
                if (sy > maxY) maxY = sy;
            }
        }
    }

    const spanX = Math.max(1e-6, maxX - minX);
    const spanY = Math.max(1e-6, maxY - minY);
    const scale = (res - 2 * PAD) / Math.max(spanX, spanY);
    const offX = (res - spanX * scale) / 2 - minX * scale;
    const offY = (res - spanY * scale) / 2 - minY * scale;

    const project = (cx: number, cy: number, cz: number): [number, number] => [
        offX + (cx - cy) * BX * scale,
        offY + ((cx + cy) * BY - cz) * scale
    ];

    // Painter's order: farthest (smallest x+y+z) first.
    const order = [...voxels].sort(
        (a, b) => a.x + a.y + a.z - (b.x + b.y + b.z)
    );

    for (const v of order) {
        const [r, g, b] = hexToRgb(v.c);
        const { x, y, z } = v;

        // +z (top) face — hidden if a voxel sits directly above.
        if (!occupied.has(key(x, y, z + 1))) {
            fillQuad(
                rgba,
                res,
                project(x, y, z + 1),
                project(x + 1, y, z + 1),
                project(x + 1, y + 1, z + 1),
                project(x, y + 1, z + 1),
                r * SHADE.top,
                g * SHADE.top,
                b * SHADE.top
            );
        }
        // +x (right) face.
        if (!occupied.has(key(x + 1, y, z))) {
            fillQuad(
                rgba,
                res,
                project(x + 1, y, z),
                project(x + 1, y + 1, z),
                project(x + 1, y + 1, z + 1),
                project(x + 1, y, z + 1),
                r * SHADE.right,
                g * SHADE.right,
                b * SHADE.right
            );
        }
        // +y (left/front) face.
        if (!occupied.has(key(x, y + 1, z))) {
            fillQuad(
                rgba,
                res,
                project(x, y + 1, z),
                project(x + 1, y + 1, z),
                project(x + 1, y + 1, z + 1),
                project(x, y + 1, z + 1),
                r * SHADE.left,
                g * SHADE.left,
                b * SHADE.left
            );
        }
    }

    return { width: res, height: res, rgba };
}

function fillQuad(
    rgba: Uint8ClampedArray,
    w: number,
    p0: [number, number],
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
    r: number,
    g: number,
    b: number
): void {
    fillTri(rgba, w, p0, p1, p2, r, g, b);
    fillTri(rgba, w, p0, p2, p3, r, g, b);
}

function edge(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    px: number,
    py: number
): number {
    return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

function fillTri(
    rgba: Uint8ClampedArray,
    w: number,
    a: [number, number],
    b: [number, number],
    c: [number, number],
    r: number,
    g: number,
    bl: number
): void {
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const maxY = Math.min(w - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const area = edge(a[0], a[1], b[0], b[1], c[0], c[1]);
    if (area === 0) return;

    const cr = Math.round(Math.min(255, r));
    const cg = Math.round(Math.min(255, g));
    const cb = Math.round(Math.min(255, bl));

    for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
            const x = px + 0.5;
            const y = py + 0.5;
            const e0 = edge(b[0], b[1], c[0], c[1], x, y);
            const e1 = edge(c[0], c[1], a[0], a[1], x, y);
            const e2 = edge(a[0], a[1], b[0], b[1], x, y);
            const inside =
                (e0 >= 0 && e1 >= 0 && e2 >= 0) ||
                (e0 <= 0 && e1 <= 0 && e2 <= 0);
            if (!inside) continue;
            const i = (py * w + px) * 4;
            rgba[i] = cr;
            rgba[i + 1] = cg;
            rgba[i + 2] = cb;
            rgba[i + 3] = 255;
        }
    }
}

/* ── PNG encoding (CompressionStream + crc32, no native deps) ─────────── */

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    void writer.write(data);
    void writer.close();
    const chunks: Uint8Array[] = [];
    const reader = cs.readable.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
    }
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.length;
    }
    return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

/** Encode an RGBA buffer as a PNG (8-bit, color type 6, filter "none"). */
export async function encodePng(
    width: number,
    height: number,
    rgba: Uint8ClampedArray
): Promise<Uint8Array> {
    const stride = width * 4;
    const raw = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0; // filter: none
        raw.set(
            rgba.subarray(y * stride, y * stride + stride),
            y * (stride + 1) + 1
        );
    }

    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, width);
    dv.setUint32(4, height);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type RGBA
    // 10..12 = compression/filter/interlace = 0

    const idat = await deflate(raw);
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const parts = [
        sig,
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', idat),
        pngChunk('IEND', new Uint8Array(0))
    ];
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    return out;
}

function toBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('base64');
    }
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

export interface RenderResult {
    pngBase64: string;
    width: number;
    height: number;
    voxelCount: number;
}

/** Rotate all voxels around the Z axis. rot: 0=identity, 1=90°CW, 2=180°, 3=270°CW (top-down). */
function rotateVoxelsZ(voxels: readonly Voxel[], rot: 0 | 1 | 2 | 3): Voxel[] {
    if (rot === 0) return [...voxels];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of voxels) {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
    }
    const W = maxX - minX;
    const H = maxY - minY;
    return voxels.map(v => {
        const lx = v.x - minX;
        const ly = v.y - minY;
        let nx: number, ny: number;
        switch (rot) {
            case 1: nx = H - ly; ny = lx; break;
            case 2: nx = W - lx; ny = H - ly; break;
            default: nx = ly; ny = W - lx; break; // 3
        }
        return { ...v, x: minX + nx, y: minY + ny };
    });
}

/**
 * Render four isometric views (NE/NW/SW/SE — rotating 90° each time) composited
 * into a 2×2 grid. Panel size is `panelRes`; output is `(2*panelRes)²`.
 * Layout: NE=top-left, NW=top-right, SW=bottom-left, SE=bottom-right.
 */
export async function renderVoxelsMultiView(
    voxels: readonly Voxel[],
    panelRes = 128
): Promise<RenderResult> {
    const P = Math.max(MIN_RESOLUTION, Math.min(MAX_RESOLUTION, Math.round(panelRes)));
    const [ne, nw, sw, se] = await Promise.all([
        Promise.resolve(rasterizeVoxels(voxels, P)),
        Promise.resolve(rasterizeVoxels(rotateVoxelsZ(voxels, 1), P)),
        Promise.resolve(rasterizeVoxels(rotateVoxelsZ(voxels, 2), P)),
        Promise.resolve(rasterizeVoxels(rotateVoxelsZ(voxels, 3), P))
    ]);
    const W = P * 2;
    const composite = new Uint8ClampedArray(W * W * 4);
    for (let py = 0; py < P; py++) {
        const rowBytes = P * 4;
        const src = py * rowBytes;
        composite.set(ne.rgba.subarray(src, src + rowBytes), py * W * 4);
        composite.set(nw.rgba.subarray(src, src + rowBytes), py * W * 4 + rowBytes);
        composite.set(sw.rgba.subarray(src, src + rowBytes), (py + P) * W * 4);
        composite.set(se.rgba.subarray(src, src + rowBytes), (py + P) * W * 4 + rowBytes);
    }
    const png = await encodePng(W, W, composite);
    return { pngBase64: toBase64(png), width: W, height: W, voxelCount: voxels.length };
}

/** Render voxels to a base64 PNG isometric preview. */
export async function renderVoxels(
    voxels: readonly Voxel[],
    resolution = 256
): Promise<RenderResult> {
    const raster = rasterizeVoxels(voxels, resolution);
    const png = await encodePng(raster.width, raster.height, raster.rgba);
    return {
        pngBase64: toBase64(png),
        width: raster.width,
        height: raster.height,
        voxelCount: voxels.length
    };
}
