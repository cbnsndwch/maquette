import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';

/**
 * Dev-server controller for the tile catalog.
 *
 *   GET  /api/tiles        → the on-disk catalog (public/voxels/catalog.json)
 *   POST /api/tiles        → save a new/updated tile: writes its `.vox` to
 *                            public/voxels/terrain/<id>.vox and upserts its
 *                            entry into the catalog manifest.
 *
 * NOTE: these endpoints live in the Vite dev server for now. As more server-side
 * pieces accrue (tile delete, scene persistence, asset processing, auth, …) we'll
 * likely want to lift them out into a standalone runtime app server (e.g. an
 * Express service) that both dev and production share, with Vite simply proxying
 * to it — rather than growing logic inside the bundler config.
 */

interface TileDef {
    id: string;
    name: string;
    category: string;
    file: string;
    stackable: boolean;
}

interface Catalog {
    tiles: TileDef[];
}

const ID_RE = /^[a-z0-9_-]+$/i;
const CATEGORIES = new Set(['terrain', 'nature', 'props', 'buildings']);

export function tilesController(): Plugin {
    return {
        name: 'three-scene-tiles-controller',
        configureServer(server) {
            const root = server.config.root;
            const voxelsDir = path.join(root, 'public', 'voxels');
            const terrainDir = path.join(voxelsDir, 'terrain');
            const catalogPath = path.join(voxelsDir, 'catalog.json');

            server.middlewares.use(
                '/api/tiles',
                (req: Connect.IncomingMessage, res: ServerResponse) => {
                    if (req.method === 'GET') {
                        void handleGet(catalogPath, res);
                    } else if (req.method === 'POST') {
                        void handlePost(req, res, terrainDir, catalogPath);
                    } else {
                        sendJson(res, 405, { error: 'method not allowed' });
                    }
                }
            );
        }
    };
}

async function readCatalog(catalogPath: string): Promise<Catalog> {
    try {
        const raw = await fs.readFile(catalogPath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<Catalog>;
        return { tiles: parsed.tiles ?? [] };
    } catch {
        return { tiles: [] };
    }
}

async function handleGet(
    catalogPath: string,
    res: ServerResponse
): Promise<void> {
    sendJson(res, 200, await readCatalog(catalogPath));
}

async function handlePost(
    req: IncomingMessage,
    res: ServerResponse,
    terrainDir: string,
    catalogPath: string
): Promise<void> {
    let body: unknown;
    try {
        body = JSON.parse(await readBody(req));
    } catch {
        return sendJson(res, 400, { error: 'invalid JSON body' });
    }

    const { id, name, category, stackable, voxBase64 } = (body ?? {}) as Record<
        string,
        unknown
    >;
    if (typeof id !== 'string' || !ID_RE.test(id)) {
        return sendJson(res, 400, { error: 'bad or missing tile id' });
    }
    if (typeof voxBase64 !== 'string' || voxBase64.length === 0) {
        return sendJson(res, 400, { error: 'missing voxBase64' });
    }
    const cat = typeof category === 'string' && CATEGORIES.has(category)
        ? category
        : 'terrain';

    const tile: TileDef = {
        id,
        name: typeof name === 'string' && name ? name : id,
        category: cat,
        file: `/voxels/terrain/${id}.vox`,
        stackable: stackable === true
    };

    try {
        await fs.mkdir(terrainDir, { recursive: true });
        await fs.writeFile(path.join(terrainDir, `${id}.vox`), voxBase64, 'base64');
        const catalog = await readCatalog(catalogPath);
        const idx = catalog.tiles.findIndex(t => t.id === id);
        if (idx >= 0) catalog.tiles[idx] = tile;
        else catalog.tiles.push(tile);
        await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 4) + '\n');
        sendJson(res, 200, { ok: true, tile });
    } catch (err) {
        sendJson(res, 500, { error: `write failed: ${String(err)}` });
    }
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => {
            data += chunk;
            if (data.length > 32 * 1024 * 1024) {
                reject(new Error('body too large'));
            }
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(obj));
}
