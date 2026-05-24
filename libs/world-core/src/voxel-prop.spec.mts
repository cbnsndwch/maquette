import { describe, expect, it } from 'vitest';

import type { BiomeRenderer } from './biome-render.mjs';
import {
    VoxAssetCache,
    decodeVox,
    encodeVox,
    voxelUnitToVoxels,
    withVoxAssets,
    type VoxAsset
} from './voxel-prop.mjs';
import type { Voxel } from './voxel.mjs';

/** Build a minimal MagicaVoxel .vox buffer (mirrors the pipeline's encoder). */
function makeVox(
    size: [number, number, number],
    voxels: [number, number, number, number][],
    palette: [number, number, number][]
): ArrayBuffer {
    const chunk = (id: string, content: Uint8Array): Uint8Array => {
        const out = new Uint8Array(12 + content.length);
        const dv = new DataView(out.buffer);
        for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
        dv.setInt32(4, content.length, true);
        dv.setInt32(8, 0, true);
        out.set(content, 12);
        return out;
    };

    const sizeContent = new Uint8Array(12);
    new DataView(sizeContent.buffer).setInt32(0, size[0], true);
    new DataView(sizeContent.buffer).setInt32(4, size[1], true);
    new DataView(sizeContent.buffer).setInt32(8, size[2], true);

    const xyzi = new Uint8Array(4 + voxels.length * 4);
    new DataView(xyzi.buffer).setInt32(0, voxels.length, true);
    voxels.forEach((v, i) => xyzi.set(v, 4 + i * 4));

    const rgba = new Uint8Array(256 * 4);
    palette.forEach((c, i) => rgba.set([c[0], c[1], c[2], 255], i * 4));

    const children = new Uint8Array([
        ...chunk('SIZE', sizeContent),
        ...chunk('XYZI', xyzi),
        ...chunk('RGBA', rgba)
    ]);
    const main = chunk('MAIN', new Uint8Array(0));
    // MAIN's childrenSize field:
    new DataView(main.buffer).setInt32(8, children.length, true);

    const header = new Uint8Array(8);
    for (let i = 0; i < 4; i++) header[i] = 'VOX '.charCodeAt(i);
    new DataView(header.buffer).setInt32(4, 150, true);

    const all = new Uint8Array(header.length + main.length + children.length);
    all.set(header, 0);
    all.set(main, header.length);
    all.set(children, header.length + main.length);
    return all.buffer;
}

describe('decodeVox', () => {
    it('decodes size, voxels, and 1-based palette colors', () => {
        const buf = makeVox(
            [12, 12, 2],
            [
                [6, 6, 0, 1], // palette idx 1 -> first color
                [6, 6, 1, 2] // palette idx 2 -> second color
            ],
            [
                [42, 111, 176], // #2a6fb0
                [110, 125, 79] // #6e7d4f
            ]
        );
        const asset = decodeVox(buf);
        expect(asset.dims).toEqual([12, 12, 2]);
        expect(asset.voxels).toHaveLength(2);
        expect(asset.voxels[0]).toEqual({ x: 6, y: 6, z: 0, c: '#2a6fb0' });
        expect(asset.voxels[1]).toEqual({ x: 6, y: 6, z: 1, c: '#6e7d4f' });
    });

    it('throws on a bad magic number', () => {
        expect(() => decodeVox(new Uint8Array(32).buffer)).toThrow(/magic/);
    });
});

describe('encodeVox', () => {
    it('round-trips through decodeVox', () => {
        const voxels: Voxel[] = [
            { x: 0, y: 0, z: 0, c: '#2a6fb0' },
            { x: 11, y: 4, z: 6, c: '#6e7d4f' },
            { x: 3, y: 9, z: 2, c: '#2a6fb0' } // reuses the first color
        ];
        const decoded = decodeVox(encodeVox(voxels));
        expect(decoded.dims).toEqual([12, 10, 7]); // max coord + 1 per axis
        expect(decoded.voxels).toEqual(voxels);
    });

    it('honors explicit dims and reuses palette entries for repeated colors', () => {
        const voxels: Voxel[] = [
            { x: 1, y: 1, z: 0, c: '#ffffff' },
            { x: 2, y: 1, z: 0, c: '#ffffff' }
        ];
        const decoded = decodeVox(encodeVox(voxels, [12, 12, 1]));
        expect(decoded.dims).toEqual([12, 12, 1]);
        expect(decoded.voxels).toEqual(voxels);
    });

    it('throws past 255 unique colors', () => {
        const voxels: Voxel[] = [];
        for (let i = 0; i < 256; i++) {
            voxels.push({ x: i % 16, y: Math.floor(i / 16), z: 0, c: `#0000${i.toString(16).padStart(2, '0')}` });
        }
        expect(() => encodeVox(voxels)).toThrow(/255 unique colors/);
    });
});

describe('voxelUnitToVoxels', () => {
    it('maps material slots to colors and expands merged cubes', () => {
        const unit = {
            cells: [
                [[{ materialId: 'bark', size: 2 }, null], [null, null]]
            ]
        };
        const voxels = voxelUnitToVoxels(unit, { bark: '#6b4a2b' });
        // size:2 at (x0,y0,z0) -> 8 voxels (2^3)
        expect(voxels).toHaveLength(8);
        expect(new Set(voxels.map(v => v.c))).toEqual(new Set(['#6b4a2b']));
    });

    it('uses the fallback color for unknown slots', () => {
        const unit = { cells: [[[{ materialId: 'mystery' }]]] };
        const voxels = voxelUnitToVoxels(unit, {}, '#123456');
        expect(voxels[0]!.c).toBe('#123456');
    });
});

describe('VoxAssetCache + withVoxAssets', () => {
    const asset: VoxAsset = {
        dims: [12, 12, 1],
        voxels: [{ x: 0, y: 0, z: 0, c: '#abcdef' }]
    };

    it('serves cached props and falls back to the base biome', () => {
        const cache = new VoxAssetCache();
        cache.set('olive-tree', asset);

        const base: BiomeRenderer = {
            tilePaletteIndex: () => 0,
            buildProp: () => ({}) as never,
            voxels: {
                perTile: 12,
                surface: () => [],
                prop: id =>
                    id === 'bench' ? [{ x: 1, y: 1, z: 0, c: '#111111' }] : []
            }
        };

        const wrapped = withVoxAssets(base, cache);
        // cached id resolves from the asset
        expect(wrapped.voxels!.prop('olive-tree')).toEqual(asset.voxels);
        // uncached id falls through to the base biome recipe
        expect(wrapped.voxels!.prop('bench')).toEqual([
            { x: 1, y: 1, z: 0, c: '#111111' }
        ]);
        expect(wrapped.voxels!.perTile).toBe(12);
    });

    it('synthesizes a voxels block when the base biome has none', () => {
        const cache = new VoxAssetCache();
        cache.set('hero', asset);
        const base: BiomeRenderer = {
            tilePaletteIndex: () => 0,
            buildProp: () => ({}) as never
        };
        const wrapped = withVoxAssets(base, cache);
        expect(wrapped.voxels!.prop('hero')).toEqual(asset.voxels);
        expect(wrapped.voxels!.prop('missing')).toEqual([]);
    });
});
