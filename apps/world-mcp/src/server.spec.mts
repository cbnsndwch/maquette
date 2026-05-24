import { existsSync } from 'node:fs';

import { parseSceneDocument } from '@cbnsndwch/scene-author';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from './server.mjs';

/** Pull the JSON payload out of a tool result. */
function payload(res: CallToolResult): any {
    if (res.structuredContent) return res.structuredContent;
    const first = res.content[0];
    return first && first.type === 'text' ? JSON.parse(first.text) : null;
}

let client: Client;

beforeAll(async () => {
    const server = await buildServer();
    const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'world-mcp-test', version: '0.0.0' });
    await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport)
    ]);
});

const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>;

describe('world-mcp tool surface', () => {
    it('lists the real catalog with a pinned version', async () => {
        const out = payload(await call('list_catalog'));
        expect(out.count).toBeGreaterThan(0);
        expect(typeof out.catalogVersion).toBe('string');
        const ids = out.tiles.map((t: { id: string }) => t.id);
        expect(ids).toContain('grass');
    });

    it('exposes the grid + rules', async () => {
        const out = payload(await call('get_grid_info'));
        expect(out.defaultGrid).toEqual({ width: 14, height: 14 });
        expect(out.rotations).toEqual([0, 1, 2, 3]);
    });

    it('authors, validates and finalizes a scene', async () => {
        const created = payload(
            await call('create_scene', {
                biome: 'mykonos',
                prompt: 'a tiny test plaza',
                width: 4,
                height: 4
            })
        );
        const { sceneId } = created;
        expect(created.width).toBe(4);

        const filled = payload(
            await call('fill_terrain', { sceneId, id: 'grass' })
        );
        expect(filled.filled).toBe(16);

        // boulder onto grass (stackable) is allowed and lands at level 1.
        const placed = payload(
            await call('place_tile', { sceneId, id: 'boulder', gx: 1, gy: 1 })
        );
        expect(placed.ok).toBe(true);
        expect(placed.placed.level).toBe(1);

        // boulder is not stackable → nothing lands on it.
        const onBoulder = await call('place_tile', {
            sceneId,
            id: 'grass',
            gx: 1,
            gy: 1
        });
        expect(onBoulder.isError).toBe(true);
        expect(payload(onBoulder).error).toBe('not_stackable');

        const scene = payload(await call('get_scene', { sceneId }));
        expect(scene.placedCells).toBe(17);
        expect(parseSceneDocument(scene.document).ok).toBe(true);

        const fin = payload(await call('finalize_scene', { sceneId }));
        expect(fin.ok).toBe(true);
        expect(fin.placedCells).toBe(17);
        expect(fin.voxelCount).toBeGreaterThan(0);
        expect(existsSync(fin.files.scene)).toBe(true);
        expect(existsSync(fin.files.vox)).toBe(true);
        expect(parseSceneDocument(fin.document).ok).toBe(true);
    });

    it('reports structured errors for bad placements', async () => {
        const { sceneId } = payload(await call('create_scene', {}));

        const oob = await call('place_tile', {
            sceneId,
            id: 'grass',
            gx: 99,
            gy: 0
        });
        expect(oob.isError).toBe(true);
        expect(payload(oob).error).toBe('out_of_bounds');

        const unknown = await call('place_tile', {
            sceneId,
            id: 'not_a_tile',
            gx: 0,
            gy: 0
        });
        expect(unknown.isError).toBe(true);
        expect(payload(unknown).error).toBe('unknown_tile');

        const missingScene = await call('get_scene', { sceneId: 'nope' });
        expect(missingScene.isError).toBe(true);
        expect(payload(missingScene).error).toBe('unknown_scene');
    });
});
