import { assetUrl } from './asset-url.mjs';
import type { BiomeRenderer } from './biome-render.mjs';
import type { Voxel } from './voxel.mjs';

/**
 * Loads pre-baked voxel props from the local CUDA pipeline (`apps/voxel-pipeline-ab`)
 * into the renderer's {@link Voxel} vocabulary, so a biome can source a hero prop
 * from a generated `.vox` / `VoxelUnit` instead of hand-coded primitives.
 *
 * The pipeline emits a fixed **12-voxel** footprint with **z up**, matching the
 * mykonos biome's `perTile`, so decoded voxels plug straight into {@link VoxelBatch}
 * with `span: 12`. Two inputs are supported:
 *
 * - `.vox` (MagicaVoxel binary) — colors are already baked from a palette.
 * - `VoxelUnit` JSON — palette-agnostic; colors are applied at load time, which
 *   is how the same asset is re-skinned per track ({@link voxelUnitToVoxels}).
 */

export interface VoxAsset {
    /** Grid dimensions `[x, y, z]` from the `.vox` SIZE chunk. */
    dims: [number, number, number];
    /** Decoded voxels in local coords (footprint x/y, z up), colors baked. */
    voxels: Voxel[];
}

const MAGIC = 0x20584f56; // 'VOX ' little-endian

function fourCC(view: DataView, offset: number): string {
    return String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
    );
}

function hex2(n: number): string {
    return n.toString(16).padStart(2, '0');
}

/** Decode a MagicaVoxel `.vox` buffer into renderer voxels. */
export function decodeVox(buffer: ArrayBuffer): VoxAsset {
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== MAGIC) {
        throw new Error('not a .vox file (bad magic)');
    }

    let dims: [number, number, number] = [0, 0, 0];
    const palette: string[] = new Array(256).fill('#ffffff');
    let xyziOffset = -1;
    let numVoxels = 0;

    // Walk chunks after the 8-byte file header + 12-byte MAIN header.
    let pos = 20;
    while (pos + 12 <= view.byteLength) {
        const id = fourCC(view, pos);
        const contentSize = view.getUint32(pos + 4, true);
        const body = pos + 12;
        if (id === 'SIZE') {
            dims = [
                view.getUint32(body, true),
                view.getUint32(body + 4, true),
                view.getUint32(body + 8, true)
            ];
        } else if (id === 'XYZI') {
            numVoxels = view.getUint32(body, true);
            xyziOffset = body + 4;
        } else if (id === 'RGBA') {
            for (let i = 0; i < 256; i++) {
                const o = body + i * 4;
                palette[i] =
                    `#${hex2(view.getUint8(o))}${hex2(view.getUint8(o + 1))}${hex2(view.getUint8(o + 2))}`;
            }
        }
        pos = body + contentSize;
    }

    const voxels: Voxel[] = [];
    if (xyziOffset >= 0) {
        for (let i = 0; i < numVoxels; i++) {
            const o = xyziOffset + i * 4;
            const colorIndex = view.getUint8(o + 3);
            voxels.push({
                x: view.getUint8(o),
                y: view.getUint8(o + 1),
                z: view.getUint8(o + 2),
                // .vox color indices are 1-based into the 256-entry palette.
                c: palette[colorIndex - 1] ?? '#ffffff'
            });
        }
    }

    return { dims, voxels };
}

/** A minimal subset of the pipeline's `VoxelUnit` JSON shape. */
export interface VoxelUnitJson {
    cells: ({ materialId: string; size?: number } | null)[][][];
}

/**
 * Convert a palette-agnostic `VoxelUnit` (slots) to renderer voxels by mapping
 * each `materialId` to a hex color, expanding merged cubes (`size` 2/3) back into
 * solid voxels. This is the per-track re-skin path: pass a different palette map
 * to recolor the same asset while preserving material semantics.
 */
export function voxelUnitToVoxels(
    unit: VoxelUnitJson,
    palette: Record<string, string>,
    fallback = '#b0b0b0'
): Voxel[] {
    const out: Voxel[] = [];
    const { cells } = unit;
    for (let z = 0; z < cells.length; z++) {
        const layer = cells[z]!;
        for (let y = 0; y < layer.length; y++) {
            const row = layer[y]!;
            for (let x = 0; x < row.length; x++) {
                const cell = row[x];
                if (!cell) continue;
                const c = palette[cell.materialId] ?? fallback;
                const s = cell.size ?? 1;
                for (let dz = 0; dz < s; dz++) {
                    for (let dy = 0; dy < s; dy++) {
                        for (let dx = 0; dx < s; dx++) {
                            out.push({ x: x + dx, y: y + dy, z: z + dz, c });
                        }
                    }
                }
            }
        }
    }
    return out;
}

/** Fetch and decode a `.vox` asset by path (resolved via {@link assetUrl}). */
export async function loadVoxAsset(path: string): Promise<VoxAsset> {
    const res = await fetch(assetUrl(path));
    if (!res.ok) {
        throw new Error(`failed to load vox asset ${path}: ${res.status}`);
    }
    return decodeVox(await res.arrayBuffer());
}

/** Maps prop/structure ids to `.vox` asset paths. */
export type VoxManifest = Record<string, string>;

/**
 * Preloads a set of `.vox` assets once and serves them synchronously by id, so
 * the synchronous {@link buildScene} path can place pre-baked props without
 * becoming async. Wire it into a biome via {@link withVoxAssets}.
 */
export class VoxAssetCache {
    readonly #assets = new Map<string, VoxAsset>();

    /** Fetch + decode every entry in the manifest in parallel. */
    async preload(manifest: VoxManifest): Promise<void> {
        await Promise.all(
            Object.entries(manifest).map(async ([id, path]) => {
                this.#assets.set(id, await loadVoxAsset(path));
            })
        );
    }

    set(id: string, asset: VoxAsset): void {
        this.#assets.set(id, asset);
    }

    has(id: string): boolean {
        return this.#assets.has(id);
    }

    getAsset(id: string): VoxAsset | undefined {
        return this.#assets.get(id);
    }

    /** Decoded voxels for an id, or `undefined` if not loaded. */
    get(id: string): Voxel[] | undefined {
        return this.#assets.get(id)?.voxels;
    }

    get size(): number {
        return this.#assets.size;
    }
}

/**
 * Wrap a {@link BiomeRenderer} so its voxel `prop`/`structure` lookups resolve
 * from a pre-baked {@link VoxAssetCache} first, falling back to the biome's own
 * hand-coded recipes. Register the result before building a scene:
 *
 * ```ts
 * const cache = new VoxAssetCache();
 * await cache.preload(manifest);
 * registerBiomeRenderer('mykonos', withVoxAssets(getBiomeRenderer('mykonos'), cache));
 * ```
 *
 * This keeps {@link buildScene} synchronous — assets are fetched up front.
 */
export function withVoxAssets(
    base: BiomeRenderer,
    cache: VoxAssetCache
): BiomeRenderer {
    const baseVox = base.voxels;
    const baseProp = baseVox?.prop;
    const baseStructure = baseVox?.structure;
    return {
        ...base,
        voxels: {
            perTile: baseVox?.perTile ?? 12,
            surface: baseVox?.surface ?? (() => []),
            prop: (id: string) => cache.get(id) ?? (baseProp ? baseProp(id) : []),
            structure: baseStructure
                ? (type: string) => cache.get(type) ?? baseStructure(type)
                : id => cache.get(id) ?? [],
            catalog: baseVox?.catalog
        }
    };
}
