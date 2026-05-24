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
