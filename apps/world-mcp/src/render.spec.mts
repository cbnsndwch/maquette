import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from './server.mjs';

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function imageBlock(res: CallToolResult) {
    return res.content.find(c => c.type === 'image') as
        | { type: 'image'; data: string; mimeType: string }
        | undefined;
}

/** Decode the PNG and confirm it starts with the PNG signature. */
function isPng(base64: string): boolean {
    const bytes = Buffer.from(base64, 'base64');
    return PNG_SIG.every((b, i) => bytes[i] === b);
}

let client: Client;

// render_* are read-only (no catalog writes), so the real public dir is fine.
beforeAll(async () => {
    const server = await buildServer();
    const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'render-test', version: '0.0.0' });
    await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport)
    ]);
});

const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>;

function payload(res: CallToolResult): any {
    return res.structuredContent ?? null;
}

describe('headless isometric renderer', () => {
    it('renders a tile preview as a PNG image block', async () => {
        const { tileSessionId } = payload(await call('create_tile', {}));
        await call('add_shape', {
            tileSessionId,
            shape: 'box',
            x: 0,
            y: 0,
            z: 0,
            w: 8,
            d: 8,
            h: 4,
            color: '#c4622e'
        });

        const res = await call('render_tile', { tileSessionId });
        const img = imageBlock(res);
        expect(img).toBeDefined();
        expect(img!.mimeType).toBe('image/png');
        expect(isPng(img!.data)).toBe(true);
        expect(Buffer.from(img!.data, 'base64').length).toBeGreaterThan(100);
    });

    it('renders a scene preview as a PNG image block', async () => {
        const { sceneId } = payload(
            await call('create_scene', { width: 4, height: 4 })
        );
        await call('fill_terrain', { sceneId, id: 'grass' });

        const res = await call('render_scene', { sceneId, resolution: 128 });
        const img = imageBlock(res);
        expect(img).toBeDefined();
        expect(isPng(img!.data)).toBe(true);
    });

    it('reports an error when there is nothing to render', async () => {
        const { tileSessionId } = payload(await call('create_tile', {}));
        const res = await call('render_tile', { tileSessionId });
        expect(res.isError).toBe(true);
        expect(payload(res).error).toBe('empty_tile');
    });
});
