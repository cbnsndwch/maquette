import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseHex } from './color.js';
import { writeRGBA, type RGBAImage } from './io.js';
import type { SegmentParams, SegmentResult } from './segment.js';

export interface WriteOptions {
    outDir: string;
    overlay: boolean; // draw wireframe over a dimmed copy of the original
    crop: boolean; // crop per-segment masks to their bounding box
    lineColor: string; // wireframe stroke, e.g. '#000000'
}

interface Manifest {
    source: string;
    width: number;
    height: number;
    mode: string;
    params: SegmentParams;
    count: number;
    segments: SegmentResult['stats'];
}

function pad(value: number, width: number): string {
    return String(value).padStart(width, '0');
}

// Emit the wireframe layer (segment boundaries), per-segment transparent masks,
// a mean-color preview, and a JSON manifest of mean colors. Returns file paths.
export async function writeOutputs(
    img: RGBAImage,
    result: SegmentResult,
    params: SegmentParams,
    source: string,
    opts: WriteOptions
): Promise<{ outDir: string; segmentsDir: string }> {
    const { width: w, height: h, labels, stats, count } = result;
    const n = w * h;
    const segmentsDir = path.join(opts.outDir, 'segments');
    await mkdir(segmentsDir, { recursive: true });

    // 1. Mean-color preview: every pixel painted with its segment's mean color.
    const meanFill = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
        const s = stats[labels[i]];
        const o = i * 4;
        meanFill[o] = s.meanRGB.r;
        meanFill[o + 1] = s.meanRGB.g;
        meanFill[o + 2] = s.meanRGB.b;
        meanFill[o + 3] = 255;
    }
    await writeRGBA(path.join(opts.outDir, 'segmented.png'), meanFill, w, h);

    // 2. Wireframe: opaque stroke on segment boundaries, otherwise transparent
    //    (or over a dimmed original when --overlay).
    const [lr, lg, lb] = parseHex(opts.lineColor);
    const wire = new Uint8Array(n * 4);
    if (opts.overlay) {
        for (let i = 0; i < n; i++) {
            const o = i * 4;
            wire[o] = img.data[o] * 0.4;
            wire[o + 1] = img.data[o + 1] * 0.4;
            wire[o + 2] = img.data[o + 2] * 0.4;
            wire[o + 3] = img.data[o + 3];
        }
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            const a = labels[i];
            const edge =
                (x + 1 < w && labels[i + 1] !== a) || (y + 1 < h && labels[i + w] !== a);
            if (!edge) continue;
            const mark = (idx: number) => {
                const o = idx * 4;
                wire[o] = lr;
                wire[o + 1] = lg;
                wire[o + 2] = lb;
                wire[o + 3] = 255;
            };
            mark(i);
            if (x + 1 < w && labels[i + 1] !== a) mark(i + 1);
            if (y + 1 < h && labels[i + w] !== a) mark(i + w);
        }
    }
    await writeRGBA(path.join(opts.outDir, 'wireframe.png'), wire, w, h);

    // 3. Per-segment masks: the segment's original pixels, everything else
    //    transparent. Full-canvas by default; bbox-cropped with --crop.
    const idWidth = Math.max(3, String(Math.max(0, count - 1)).length);
    for (const s of stats) {
        const file = path.join(segmentsDir, `seg_${pad(s.id, idWidth)}.png`);
        if (opts.crop) {
            const { x: bx, y: by, w: bw, h: bh } = s.bbox;
            const buf = new Uint8Array(bw * bh * 4);
            for (let yy = 0; yy < bh; yy++) {
                for (let xx = 0; xx < bw; xx++) {
                    const src = (by + yy) * w + (bx + xx);
                    if (labels[src] !== s.id) continue;
                    const so = src * 4;
                    const dst = (yy * bw + xx) * 4;
                    buf[dst] = img.data[so];
                    buf[dst + 1] = img.data[so + 1];
                    buf[dst + 2] = img.data[so + 2];
                    buf[dst + 3] = img.data[so + 3];
                }
            }
            await writeRGBA(file, buf, bw, bh);
        } else {
            const buf = new Uint8Array(n * 4);
            const { x: bx, y: by, w: bw, h: bh } = s.bbox;
            for (let yy = 0; yy < bh; yy++) {
                for (let xx = 0; xx < bw; xx++) {
                    const src = (by + yy) * w + (bx + xx);
                    if (labels[src] !== s.id) continue;
                    const o = src * 4;
                    buf[o] = img.data[o];
                    buf[o + 1] = img.data[o + 1];
                    buf[o + 2] = img.data[o + 2];
                    buf[o + 3] = img.data[o + 3];
                }
            }
            await writeRGBA(file, buf, w, h);
        }
    }

    // 4. Manifest with mean color per segment.
    const manifest: Manifest = {
        source,
        width: w,
        height: h,
        mode: params.mode,
        params,
        count,
        segments: stats
    };
    await writeFile(
        path.join(opts.outDir, 'segments.json'),
        JSON.stringify(manifest, null, 2),
        'utf-8'
    );

    return { outDir: opts.outDir, segmentsDir };
}
