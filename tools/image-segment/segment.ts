import {
    colorDist,
    labDist,
    rgbToHsl,
    rgbToLab,
    toHex,
    type LabWeights,
    type Sigma
} from './color.js';
import type { RGBAImage } from './io.js';

export interface SegmentParams {
    mode: 'grow' | 'quantize';
    metric: 'hsl' | 'lab';
    sigma: Sigma; // HSL metric: per-channel σ
    labWeights: LabWeights; // Lab metric: per-axis weight
    threshold: number; // accept radius vs the seed color (σ for hsl, ΔE for lab)
    local: number; // accept radius vs the adjacent pixel
    minSize: number; // segments smaller than this are merged into a neighbor
    connectivity: 4 | 8;
    k: number; // cluster count for --mode=quantize
    groupTol: number; // >0: union segments within this color distance, ignoring adjacency
}

export interface SegmentStat {
    id: number;
    pixels: number;
    bbox: { x: number; y: number; w: number; h: number };
    centroid: { x: number; y: number };
    meanRGB: { r: number; g: number; b: number };
    meanHex: string;
    meanHSL: { h: number; s: number; l: number };
    meanLab: { L: number; a: number; b: number };
}

export interface SegmentResult {
    width: number;
    height: number;
    labels: Int32Array; // final compact label per pixel, 0..count-1
    count: number;
    stats: SegmentStat[]; // ordered largest-first, index === label id
}

// Distance between two points in the active color space (channels c0/c1/c2).
type DistFn = (a0: number, a1: number, a2: number, b0: number, b1: number, b2: number) => number;

interface RawLabels {
    labels: Int32Array;
    count: number;
}

const neighborOffsets = (conn: 4 | 8): Array<[number, number]> =>
    conn === 8
        ? [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
              [1, 1],
              [1, -1],
              [-1, 1],
              [-1, -1]
          ]
        : [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1]
          ];

// Seed-anchored fuzzy flood fill: each region is the connected set of pixels
// within `threshold` of the seed color, reached via steps each within `local`
// of the previous pixel (edge-stopping).
function growRaw(
    c0: Float32Array,
    c1: Float32Array,
    c2: Float32Array,
    w: number,
    h: number,
    p: SegmentParams,
    dist: DistFn
): RawLabels {
    const n = w * h;
    const labels = new Int32Array(n).fill(-1);
    const queue = new Int32Array(n);
    const offs = neighborOffsets(p.connectivity);
    let count = 0;

    for (let start = 0; start < n; start++) {
        if (labels[start] !== -1) continue;
        const id = count++;
        const s0 = c0[start];
        const s1 = c1[start];
        const s2 = c2[start];
        let head = 0;
        let tail = 0;
        labels[start] = id;
        queue[tail++] = start;

        while (head < tail) {
            const cur = queue[head++];
            const cx = cur % w;
            const cy = (cur / w) | 0;
            const p0 = c0[cur];
            const p1 = c1[cur];
            const p2 = c2[cur];

            for (const [dx, dy] of offs) {
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const ni = ny * w + nx;
                if (labels[ni] !== -1) continue;
                const n0 = c0[ni];
                const n1 = c1[ni];
                const n2 = c2[ni];
                if (dist(n0, n1, n2, s0, s1, s2) > p.threshold) continue;
                if (dist(n0, n1, n2, p0, p1, p2) > p.local) continue;
                labels[ni] = id;
                queue[tail++] = ni;
            }
        }
    }

    return { labels, count };
}

// Deterministic LCG so quantize runs are reproducible.
function makeRng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

// k-means in the active color space, then split each cluster into connected
// components. For HSL the hue is mapped through a cylinder (x=s·cosh, y=s·sinh,
// z=l) so it wraps; for Lab the weighted (L*,a*,b*) axes are clustered directly.
function quantizeRaw(
    c0: Float32Array,
    c1: Float32Array,
    c2: Float32Array,
    w: number,
    h: number,
    p: SegmentParams
): RawLabels {
    const n = w * h;
    const k = Math.max(1, Math.min(64, Math.floor(p.k)));
    const fx = new Float32Array(n);
    const fy = new Float32Array(n);
    const fz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        if (p.metric === 'lab') {
            fx[i] = c1[i] * p.labWeights.a;
            fy[i] = c2[i] * p.labWeights.b;
            fz[i] = c0[i] * p.labWeights.l;
        } else {
            const hr = (c0[i] * Math.PI) / 180;
            const s = c1[i] / 100;
            fx[i] = s * Math.cos(hr);
            fy[i] = s * Math.sin(hr);
            fz[i] = c2[i] / 100;
        }
    }

    const rng = makeRng(0x9e3779b1);
    const cx = new Float64Array(k);
    const cy = new Float64Array(k);
    const cz = new Float64Array(k);

    // k-means++ seeding.
    const first = Math.floor(rng() * n);
    cx[0] = fx[first];
    cy[0] = fy[first];
    cz[0] = fz[first];
    const dist2 = new Float64Array(n).fill(Infinity);
    for (let c = 1; c < k; c++) {
        let sum = 0;
        for (let i = 0; i < n; i++) {
            const dx = fx[i] - cx[c - 1];
            const dy = fy[i] - cy[c - 1];
            const dz = fz[i] - cz[c - 1];
            const d = dx * dx + dy * dy + dz * dz;
            if (d < dist2[i]) dist2[i] = d;
            sum += dist2[i];
        }
        let target = rng() * sum;
        let pick = 0;
        for (let i = 0; i < n; i++) {
            target -= dist2[i];
            if (target <= 0) {
                pick = i;
                break;
            }
        }
        cx[c] = fx[pick];
        cy[c] = fy[pick];
        cz[c] = fz[pick];
    }

    const cluster = new Int32Array(n);
    const sx = new Float64Array(k);
    const sy = new Float64Array(k);
    const sz = new Float64Array(k);
    const cnt = new Int32Array(k);
    for (let iter = 0; iter < 16; iter++) {
        sx.fill(0);
        sy.fill(0);
        sz.fill(0);
        cnt.fill(0);
        for (let i = 0; i < n; i++) {
            let best = 0;
            let bestD = Infinity;
            for (let c = 0; c < k; c++) {
                const dx = fx[i] - cx[c];
                const dy = fy[i] - cy[c];
                const dz = fz[i] - cz[c];
                const d = dx * dx + dy * dy + dz * dz;
                if (d < bestD) {
                    bestD = d;
                    best = c;
                }
            }
            cluster[i] = best;
            sx[best] += fx[i];
            sy[best] += fy[i];
            sz[best] += fz[i];
            cnt[best]++;
        }
        for (let c = 0; c < k; c++) {
            if (cnt[c] === 0) continue;
            cx[c] = sx[c] / cnt[c];
            cy[c] = sy[c] / cnt[c];
            cz[c] = sz[c] / cnt[c];
        }
    }

    return connectedComponents(cluster, w, h, p.connectivity);
}

// Group connected pixels that share the same integer label value.
function connectedComponents(src: Int32Array, w: number, h: number, conn: 4 | 8): RawLabels {
    const n = w * h;
    const labels = new Int32Array(n).fill(-1);
    const queue = new Int32Array(n);
    const offs = neighborOffsets(conn);
    let count = 0;

    for (let start = 0; start < n; start++) {
        if (labels[start] !== -1) continue;
        const id = count++;
        const value = src[start];
        let head = 0;
        let tail = 0;
        labels[start] = id;
        queue[tail++] = start;
        while (head < tail) {
            const cur = queue[head++];
            const ccx = cur % w;
            const ccy = (cur / w) | 0;
            for (const [dx, dy] of offs) {
                const nx = ccx + dx;
                const ny = ccy + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const ni = ny * w + nx;
                if (labels[ni] !== -1 || src[ni] !== value) continue;
                labels[ni] = id;
                queue[tail++] = ni;
            }
        }
    }

    return { labels, count };
}

export function segment(img: RGBAImage, p: SegmentParams): SegmentResult {
    const { width: w, height: h, data } = img;
    const n = w * h;

    // Active color space: per-pixel channels, a distance function, and a way to
    // map a mean RGB back into channels (for the small-segment merge step).
    const useLab = p.metric === 'lab';
    const rgbToChannels = (r: number, g: number, b: number): [number, number, number] => {
        if (useLab) {
            const lab = rgbToLab(r, g, b);
            return [lab.L, lab.a, lab.b];
        }
        const hsl = rgbToHsl(r, g, b);
        return [hsl.h, hsl.s, hsl.l];
    };
    const dist: DistFn = useLab
        ? (a0, a1, a2, b0, b1, b2) => labDist(a0, a1, a2, b0, b1, b2, p.labWeights)
        : (a0, a1, a2, b0, b1, b2) => colorDist(a0, a1, a2, b0, b1, b2, p.sigma);

    const c0 = new Float32Array(n);
    const c1 = new Float32Array(n);
    const c2 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        const [x, y, z] = rgbToChannels(data[o], data[o + 1], data[o + 2]);
        c0[i] = x;
        c1[i] = y;
        c2[i] = z;
    }

    const raw =
        p.mode === 'quantize'
            ? quantizeRaw(c0, c1, c2, w, h, p)
            : growRaw(c0, c1, c2, w, h, p, dist);
    const { labels, count: rawCount } = raw;

    // Per-raw-segment accumulators.
    const px = new Int32Array(rawCount);
    const sumR = new Float64Array(rawCount);
    const sumG = new Float64Array(rawCount);
    const sumB = new Float64Array(rawCount);
    const sumX = new Float64Array(rawCount);
    const sumY = new Float64Array(rawCount);
    const minX = new Int32Array(rawCount).fill(w);
    const minY = new Int32Array(rawCount).fill(h);
    const maxX = new Int32Array(rawCount).fill(-1);
    const maxY = new Int32Array(rawCount).fill(-1);
    for (let i = 0; i < n; i++) {
        const id = labels[i];
        const o = i * 4;
        px[id]++;
        sumR[id] += data[o];
        sumG[id] += data[o + 1];
        sumB[id] += data[o + 2];
        const x = i % w;
        const y = (i / w) | 0;
        sumX[id] += x;
        sumY[id] += y;
        if (x < minX[id]) minX[id] = x;
        if (y < minY[id]) minY[id] = y;
        if (x > maxX[id]) maxX[id] = x;
        if (y > maxY[id]) maxY[id] = y;
    }

    // Adjacency between raw segments (by shared 4-neighbor edges).
    const adj: Array<Set<number>> = Array.from({ length: rawCount }, () => new Set<number>());
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            const a = labels[i];
            if (x + 1 < w) {
                const b = labels[i + 1];
                if (a !== b) {
                    adj[a].add(b);
                    adj[b].add(a);
                }
            }
            if (y + 1 < h) {
                const b = labels[i + w];
                if (a !== b) {
                    adj[a].add(b);
                    adj[b].add(a);
                }
            }
        }
    }

    // Union-find merge of sub-minSize segments into their closest-color neighbor.
    const parent = new Int32Array(rawCount);
    for (let i = 0; i < rawCount; i++) parent[i] = i;
    const find = (i: number): number => {
        while (parent[i] !== i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    };
    const meanChannelsOf = (r: number): [number, number, number] =>
        rgbToChannels(sumR[r] / px[r], sumG[r] / px[r], sumB[r] / px[r]);

    if (p.minSize > 1 && rawCount > 1) {
        let changed = true;
        let pass = 0;
        while (changed && pass++ < 8) {
            changed = false;
            const roots: number[] = [];
            for (let i = 0; i < rawCount; i++) if (find(i) === i) roots.push(i);
            roots.sort((a, b) => px[a] - px[b]);
            for (const root of roots) {
                if (find(root) !== root || px[root] >= p.minSize) continue;
                const [r0, r1, r2] = meanChannelsOf(root);
                let best = -1;
                let bestD = Infinity;
                for (const nb of adj[root]) {
                    const r2id = find(nb);
                    if (r2id === root) continue;
                    const [o0, o1, o2] = meanChannelsOf(r2id);
                    const d = dist(r0, r1, r2, o0, o1, o2);
                    if (d < bestD) {
                        bestD = d;
                        best = r2id;
                    }
                }
                if (best === -1) continue; // isolated (e.g. whole image): leave as-is
                parent[root] = best;
                px[best] += px[root];
                sumR[best] += sumR[root];
                sumG[best] += sumG[root];
                sumB[best] += sumB[root];
                sumX[best] += sumX[root];
                sumY[best] += sumY[root];
                if (minX[root] < minX[best]) minX[best] = minX[root];
                if (minY[root] < minY[best]) minY[best] = minY[root];
                if (maxX[root] > maxX[best]) maxX[best] = maxX[root];
                if (maxY[root] > maxY[best]) maxY[best] = maxY[root];
                for (const nb of adj[root]) adj[best].add(nb);
                changed = true;
            }
        }
    }

    // Optional color-family union: merge segments whose mean colors are within
    // groupTol in the active metric, even when not spatially adjacent. Uses a
    // leader algorithm (largest segments anchor families with a fixed reference
    // color; smaller segments attach to the nearest family) to avoid the
    // single-linkage chaining that would bridge a near-continuous color ramp.
    if (p.groupTol > 0) {
        const live: number[] = [];
        for (let i = 0; i < rawCount; i++) if (find(i) === i) live.push(i);
        live.sort((a, b) => px[b] - px[a]);
        const leaders: number[] = [];
        const leaderMean = new Map<number, [number, number, number]>();
        for (const r of live) {
            const mr = meanChannelsOf(r);
            let best = -1;
            let bestD = p.groupTol;
            for (const leader of leaders) {
                const ml = leaderMean.get(leader);
                if (!ml) continue;
                const d = dist(mr[0], mr[1], mr[2], ml[0], ml[1], ml[2]);
                if (d < bestD) {
                    bestD = d;
                    best = leader;
                }
            }
            if (best === -1) {
                leaders.push(r);
                leaderMean.set(r, mr);
                continue;
            }
            parent[r] = best;
            px[best] += px[r];
            sumR[best] += sumR[r];
            sumG[best] += sumG[r];
            sumB[best] += sumB[r];
            sumX[best] += sumX[r];
            sumY[best] += sumY[r];
            if (minX[r] < minX[best]) minX[best] = minX[r];
            if (minY[r] < minY[best]) minY[best] = minY[r];
            if (maxX[r] > maxX[best]) maxX[best] = maxX[r];
            if (maxY[r] > maxY[best]) maxY[best] = maxY[r];
        }
    }

    // Compact surviving roots into final ids, ordered largest-first.
    const roots: number[] = [];
    for (let i = 0; i < rawCount; i++) if (find(i) === i) roots.push(i);
    roots.sort((a, b) => px[b] - px[a]);
    const remap = new Int32Array(rawCount).fill(-1);
    roots.forEach((r, idx) => {
        remap[r] = idx;
    });

    const finalLabels = new Int32Array(n);
    for (let i = 0; i < n; i++) finalLabels[i] = remap[find(labels[i])];

    const stats: SegmentStat[] = roots.map((r, idx) => {
        const r0 = sumR[r] / px[r];
        const g0 = sumG[r] / px[r];
        const b0 = sumB[r] / px[r];
        const hsl = rgbToHsl(r0, g0, b0);
        const lab = rgbToLab(r0, g0, b0);
        return {
            id: idx,
            pixels: px[r],
            bbox: { x: minX[r], y: minY[r], w: maxX[r] - minX[r] + 1, h: maxY[r] - minY[r] + 1 },
            centroid: { x: Math.round(sumX[r] / px[r]), y: Math.round(sumY[r] / px[r]) },
            meanRGB: { r: Math.round(r0), g: Math.round(g0), b: Math.round(b0) },
            meanHex: toHex(r0, g0, b0),
            meanHSL: {
                h: Math.round(hsl.h * 10) / 10,
                s: Math.round(hsl.s * 10) / 10,
                l: Math.round(hsl.l * 10) / 10
            },
            meanLab: {
                L: Math.round(lab.L * 10) / 10,
                a: Math.round(lab.a * 10) / 10,
                b: Math.round(lab.b * 10) / 10
            }
        };
    });

    return { width: w, height: h, labels: finalLabels, count: roots.length, stats };
}
