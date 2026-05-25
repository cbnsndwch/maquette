#!/usr/bin/env tsx
import path from 'node:path';
import { parseArgs } from 'node:util';

import { loadRGBA } from './io.js';
import { segment, type SegmentParams } from './segment.js';
import { writeOutputs } from './outputs.js';

const HELP = `image-segment — segment an image by connected shape + HSL color.

Usage:
  tsx tools/image-segment/main.ts <image> [options]

Options:
  --out <dir>          Output directory (default: ./segments-out/<name>)
  --mode <grow|quantize>
                       grow (default): seed-anchored fuzzy flood fill.
                       quantize: k-means palette, then connected components.
  --metric <hsl|lab>   Color space for the distance metric (default hsl).
                       lab = CIELAB ΔE — better for subtle/desaturated tones.

  HSL metric (--metric hsl):
    --sigma-h <deg>    Hue gaussian σ in degrees        (default 12)
    --sigma-s <0-100>  Saturation gaussian σ            (default 12)
    --sigma-l <0-100>  Lightness gaussian σ             (default 12)

  Lab metric (--metric lab):
    --wl <n>           L* (lightness) weight            (default 1)
    --wa <n>           a* (green–red) weight            (default 2)
    --wb <n>           b* (blue–yellow / warmth) weight (default 2)

  --threshold <n>      Accept radius vs the seed color
                       (default 3 for hsl, 10 for lab)
  --local <n>          Accept radius vs adjacent pixel  (default = threshold)
  --min-size <px>      Merge segments smaller than this into a neighbor (default 64)
  --group <n>          Union segments within this color distance even when not
                       adjacent, i.e. group by material across gaps (default 0=off)
  --connectivity <4|8> Pixel adjacency                  (default 4)
  --k <int>            Cluster count for --mode=quantize (default 12)
  --max-dim <px>       Downscale longest side before segmenting (default: none)
  --overlay            Draw wireframe over a dimmed copy of the original
  --crop               Crop per-segment masks to their bounding box
  --line-color <hex>   Wireframe stroke color           (default #000000)
  -h, --help           Show this help

Outputs (in <out>):
  wireframe.png        Segment boundaries (transparent layer, or --overlay)
  segmented.png        Every pixel painted with its segment's mean color
  segments/seg_NNN.png One transparent mask per segment (largest first)
  segments.json        Per-segment mean color, bbox, centroid, pixel count
`;

function num(value: string | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`expected a number, got "${value}"`);
    return n;
}

async function run(): Promise<void> {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            out: { type: 'string' },
            mode: { type: 'string', default: 'grow' },
            metric: { type: 'string', default: 'hsl' },
            'sigma-h': { type: 'string', default: '12' },
            'sigma-s': { type: 'string', default: '12' },
            'sigma-l': { type: 'string', default: '12' },
            wl: { type: 'string', default: '1' },
            wa: { type: 'string', default: '2' },
            wb: { type: 'string', default: '2' },
            threshold: { type: 'string' },
            local: { type: 'string' },
            'min-size': { type: 'string', default: '64' },
            group: { type: 'string', default: '0' },
            connectivity: { type: 'string', default: '4' },
            k: { type: 'string', default: '12' },
            'max-dim': { type: 'string' },
            overlay: { type: 'boolean', default: false },
            crop: { type: 'boolean', default: false },
            'line-color': { type: 'string', default: '#000000' },
            help: { type: 'boolean', short: 'h', default: false }
        }
    });

    if (values.help || positionals.length === 0) {
        process.stdout.write(HELP);
        process.exit(values.help ? 0 : 1);
    }

    const input = positionals[0];
    const mode = values.mode === 'quantize' ? 'quantize' : 'grow';
    const metric = values.metric === 'lab' ? 'lab' : 'hsl';
    const connectivity = values.connectivity === '8' ? 8 : 4;
    const defaultThreshold = metric === 'lab' ? 10 : 3;
    const threshold = values.threshold !== undefined ? num(values.threshold, defaultThreshold) : defaultThreshold;

    const params: SegmentParams = {
        mode,
        metric,
        sigma: {
            h: num(values['sigma-h'], 12),
            s: num(values['sigma-s'], 12),
            l: num(values['sigma-l'], 12)
        },
        labWeights: {
            l: num(values.wl, 1),
            a: num(values.wa, 2),
            b: num(values.wb, 2)
        },
        threshold,
        local: values.local !== undefined ? num(values.local, threshold) : threshold,
        minSize: num(values['min-size'], 64),
        connectivity,
        k: num(values.k, 12),
        groupTol: num(values.group, 0)
    };

    const maxDim = values['max-dim'] !== undefined ? num(values['max-dim'], 0) : undefined;
    const base = path.basename(input, path.extname(input));
    const outDir = values.out ?? path.join(process.cwd(), 'segments-out', base);

    const started = Date.now();
    const img = await loadRGBA(input, maxDim);
    const result = segment(img, params);

    if (result.count > 256) {
        process.stderr.write(
            `warning: ${result.count} segments — writing that many PNGs may be slow. ` +
                `Raise --min-size or --threshold to merge more.\n`
        );
    }

    const { outDir: written } = await writeOutputs(img, result, params, input, {
        outDir,
        overlay: values.overlay,
        crop: values.crop,
        lineColor: values['line-color']
    });

    const ms = Date.now() - started;
    process.stdout.write(
        `${result.count} segments from ${img.width}×${img.height} ` +
            `(${mode}/${metric}, threshold ${threshold}) in ${ms}ms\n` +
            `→ ${written}\n`
    );
}

run().catch((err: unknown) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
