import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { PUBLIC_DIR } from './catalog.mjs';
import { buildServer } from './server.mjs';

function payload(res: CallToolResult): any {
    if (res.structuredContent) return res.structuredContent;
    const first = res.content[0];
    return first && first.type === 'text' ? JSON.parse(first.text) : null;
}

let client: Client;

// Author tiles against a throwaway copy of the catalog so the real repo files
// are never touched.
beforeAll(async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'world-mcp-tiles-'));
    const publicDir = path.join(root, 'public');
    await cp(path.join(PUBLIC_DIR, 'voxels'), path.join(publicDir, 'voxels'), {
        recursive: true
    });

    const server = await buildServer({
        publicDir,
        outDir: path.join(root, 'out')
    });
    const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'tile-test', version: '0.0.0' });
    await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport)
    ]);
});

const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>;

describe('tile authoring', () => {
    it('builds a tile from shapes, saves it, and places it in a scene', async () => {
        const { tileSessionId } = payload(
            await call('create_tile', { category: 'nature', stackable: false })
        );
        expect(typeof tileSessionId).toBe('string');

        const box = payload(
            await call('add_shape', {
                tileSessionId,
                shape: 'box',
                x: 0,
                y: 0,
                z: 0,
                w: 12,
                d: 12,
                h: 3,
                color: '#7eaa5f'
            })
        );
        expect(box.voxelCount).toBe(12 * 12 * 3);
        expect(box.outOfFootprint).toBe(0);

        const dome = payload(
            await call('add_shape', {
                tileSessionId,
                shape: 'dome',
                cx: 6,
                cy: 6,
                z: 3,
                radius: 3,
                color: '#5c8a44'
            })
        );
        expect(dome.ok).toBe(true);

        const info = payload(await call('get_tile_info', { tileSessionId }));
        expect(info.ready).toBe(true);
        expect(info.colorCount).toBe(2);

        const saved = payload(
            await call('save_tile', { tileSessionId, id: 'agent_bush' })
        );
        expect(saved.ok).toBe(true);
        expect(saved.tile.id).toBe('agent_bush');
        expect(saved.tile.file).toBe('/voxels/terrain/agent_bush.vox');

        // The freshly authored tile is now in the catalog…
        const cat = payload(await call('list_catalog'));
        expect(cat.tiles.map((t: { id: string }) => t.id)).toContain(
            'agent_bush'
        );

        // …and immediately placeable in a scene.
        const { sceneId } = payload(
            await call('create_scene', { width: 3, height: 3 })
        );
        const placed = payload(
            await call('place_tile', {
                sceneId,
                id: 'agent_bush',
                gx: 1,
                gy: 1
            })
        );
        expect(placed.ok).toBe(true);

        const fin = payload(await call('finalize_scene', { sceneId }));
        expect(fin.ok).toBe(true);
        expect(fin.voxelCount).toBeGreaterThan(0);
    });

    it('soft-deletes a tile out of the catalog', async () => {
        const { tileSessionId } = payload(await call('create_tile', {}));
        await call('add_shape', {
            tileSessionId,
            shape: 'box',
            x: 0,
            y: 0,
            z: 0,
            w: 4,
            d: 4,
            h: 1,
            color: '#cdc8b8'
        });
        await call('save_tile', { tileSessionId, id: 'agent_temp' });

        const del = payload(await call('delete_tile', { id: 'agent_temp' }));
        expect(del.ok).toBe(true);

        const cat = payload(await call('list_catalog'));
        expect(cat.tiles.map((t: { id: string }) => t.id)).not.toContain(
            'agent_temp'
        );

        const missing = await call('delete_tile', { id: 'never_existed' });
        expect(missing.isError).toBe(true);
        expect(payload(missing).error).toBe('not_found');
    });

    it('authors a 2×2 building, places it as one unit, and bakes it', async () => {
        const { tileSessionId, footprint } = payload(
            await call('create_tile', {
                category: 'buildings',
                stackable: false,
                footprint: [2, 2]
            })
        );
        expect(footprint).toEqual({ cells: [2, 2], width: 24, height: 24 });

        const box = payload(
            await call('add_shape', {
                tileSessionId,
                shape: 'box',
                x: 0,
                y: 0,
                z: 0,
                w: 24,
                d: 24,
                h: 2,
                color: '#cdc8b8'
            })
        );
        expect(box.outOfFootprint).toBe(0);
        expect(box.dims).toEqual([24, 24, 2]);

        const saved = payload(
            await call('save_tile', { tileSessionId, id: 'agent_house' })
        );
        expect(saved.ok).toBe(true);
        expect(saved.footprint).toEqual([2, 2]);
        expect(saved.tile.footprint).toEqual([2, 2]);

        const { sceneId } = payload(
            await call('create_scene', { width: 6, height: 6 })
        );

        // Hangs off the edge of a 6×6 grid → out_of_bounds.
        const oob = payload(
            await call('can_place', { sceneId, id: 'agent_house', gx: 5, gy: 5 })
        );
        expect(oob).toMatchObject({ ok: false, reason: 'out_of_bounds' });

        const placed = payload(
            await call('place_tile', {
                sceneId,
                id: 'agent_house',
                gx: 1,
                gy: 1
            })
        );
        expect(placed.ok).toBe(true);
        expect(placed.placed).toMatchObject({ ax: 1, ay: 1, footprint: [2, 2] });

        // A 1×1 tile may not land inside the footprint.
        const intruder = await call('place_tile', {
            sceneId,
            id: 'grass',
            gx: 2,
            gy: 2
        });
        expect(intruder.isError).toBe(true);
        expect(payload(intruder).error).toBe('occupied');

        const scene = payload(await call('get_scene', { sceneId }));
        expect(scene.document.buildings).toHaveLength(1);

        const fin = payload(await call('finalize_scene', { sceneId }));
        expect(fin.ok).toBe(true);
        expect(fin.voxelCount).toBeGreaterThan(0);

        // Erasing any covered cell removes the whole building.
        const erased = payload(
            await call('erase_cell', { sceneId, gx: 2, gy: 2 })
        );
        expect(erased.removed).toBe(true);
        const after = payload(await call('get_scene', { sceneId }));
        expect(after.document.buildings).toHaveLength(0);
    });

    it('authors a high-resolution (r=24) tile, persists r, and bakes it', async () => {
        const { tileSessionId, footprint, resolution } = payload(
            await call('create_tile', {
                category: 'nature',
                stackable: false,
                resolution: 24
            })
        );
        // A 1×1 cell at r=24 is a 24×24 author grid in the same world cell.
        expect(footprint).toEqual({ cells: [1, 1], width: 24, height: 24 });
        expect(resolution).toBe(24);

        const box = payload(
            await call('add_shape', {
                tileSessionId,
                shape: 'box',
                x: 0,
                y: 0,
                z: 0,
                w: 24,
                d: 24,
                h: 2,
                color: '#7eaa5f'
            })
        );
        expect(box.outOfFootprint).toBe(0);
        expect(box.dims).toEqual([24, 24, 2]);

        const saved = payload(
            await call('save_tile', { tileSessionId, id: 'agent_fine' })
        );
        expect(saved.ok).toBe(true);
        expect(saved.resolution).toBe(24);
        expect(saved.tile.resolution).toBe(24);

        const cat = payload(await call('list_catalog'));
        const fine = cat.tiles.find((t: { id: string }) => t.id === 'agent_fine');
        expect(fine.resolution).toBe(24);

        // …and it places + bakes among ordinary r=12 terrain.
        const { sceneId } = payload(
            await call('create_scene', { width: 3, height: 3 })
        );
        await call('fill_terrain', { sceneId, id: 'grass' });
        await call('erase_cell', { sceneId, gx: 1, gy: 1 });
        const placed = payload(
            await call('place_tile', { sceneId, id: 'agent_fine', gx: 1, gy: 1 })
        );
        expect(placed.ok).toBe(true);
        const fin = payload(await call('finalize_scene', { sceneId }));
        expect(fin.ok).toBe(true);
        expect(fin.voxelCount).toBeGreaterThan(0);
    });

    it('rejects a tile whose footprint × resolution exceeds the 256-axis cap', async () => {
        const { tileSessionId, footprint } = payload(
            await call('create_tile', {
                category: 'buildings',
                footprint: [6, 1],
                resolution: 48
            })
        );
        // 6 cells × 48 = 288 voxels wide — over the .vox 256-per-axis cap.
        expect(footprint.width).toBe(288);

        await call('add_shape', {
            tileSessionId,
            shape: 'box',
            x: 0,
            y: 0,
            z: 0,
            w: 4,
            d: 1,
            h: 1,
            color: '#cdc8b8'
        });
        const save = await call('save_tile', { tileSessionId, id: 'agent_huge' });
        expect(save.isError).toBe(true);
        const out = payload(save);
        expect(out.error).toBe('invalid_tile');
        expect(out.issues.join(' ')).toMatch(/256/);
    });

    it('flags voxels outside the declared footprint', async () => {
        const { tileSessionId } = payload(
            await call('create_tile', { category: 'buildings', footprint: [2, 1] })
        );
        // A 2×1 footprint is 24×12 voxels; y up to 13 overflows the depth.
        const over = payload(
            await call('add_shape', {
                tileSessionId,
                shape: 'box',
                x: 0,
                y: 0,
                z: 0,
                w: 24,
                d: 14,
                h: 1,
                color: '#ffffff'
            })
        );
        expect(over.outOfFootprint).toBeGreaterThan(0);
    });

    it('rejects an empty tile and an out-of-footprint tile', async () => {
        const empty = payload(await call('create_tile', {}));
        const emptySave = await call('save_tile', {
            tileSessionId: empty.tileSessionId,
            id: 'agent_empty'
        });
        expect(emptySave.isError).toBe(true);
        expect(payload(emptySave).error).toBe('invalid_tile');

        const over = payload(await call('create_tile', {}));
        const overShape = payload(
            await call('add_shape', {
                tileSessionId: over.tileSessionId,
                shape: 'box',
                x: 10,
                y: 0,
                z: 0,
                w: 5,
                d: 2,
                h: 1,
                color: '#ffffff'
            })
        );
        expect(overShape.outOfFootprint).toBeGreaterThan(0);

        const overSave = await call('save_tile', {
            tileSessionId: over.tileSessionId,
            id: 'agent_over'
        });
        expect(overSave.isError).toBe(true);
        expect(payload(overSave).error).toBe('invalid_tile');
    });
});
