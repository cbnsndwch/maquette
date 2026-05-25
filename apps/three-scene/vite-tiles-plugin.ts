import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Connect, Plugin } from 'vite';

/**
 * Dev-server controller for the tile catalog.
 *
 *   GET    /api/tiles       → the on-disk catalog (public/voxels/catalog.json)
 *   POST   /api/tiles       → save a new/updated tile: writes its `.vox` to
 *                            public/voxels/terrain/<id>.vox and upserts its
 *                            entry into the catalog manifest.
 *   DELETE /api/tiles/<id>  → soft-delete: flag the catalog entry `deleted`,
 *                            leaving the `.vox` file in place (reversible).
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
    footprint?: [number, number];
    deleted?: boolean;
}

/** Coerce an unknown value to a valid `[w, d]` footprint (1..8), or null. */
function parseFootprint(value: unknown): [number, number] | null {
    if (!Array.isArray(value) || value.length !== 2) return null;
    const w = Math.round(Number(value[0]));
    const d = Math.round(Number(value[1]));
    if (!Number.isFinite(w) || !Number.isFinite(d)) return null;
    if (w < 1 || d < 1 || w > 8 || d > 8) return null;
    return [w, d];
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
                    // Mount path is stripped: `/api/tiles/<id>` → req.url `/<id>`.
                    const id = (req.url ?? '').split('?')[0]!.replace(/^\/+/, '');
                    if (req.method === 'GET') {
                        void handleGet(catalogPath, res);
                    } else if (req.method === 'POST') {
                        void handlePost(req, res, terrainDir, catalogPath);
                    } else if (req.method === 'DELETE') {
                        void handleDelete(id, res, catalogPath);
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

    const { id, name, category, stackable, footprint, voxBase64 } = (body ??
        {}) as Record<string, unknown>;
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
    // Persist a multi-cell footprint; a 1×1 default stays implicit (back-compat).
    const fp = parseFootprint(footprint);
    if (fp && (fp[0] > 1 || fp[1] > 1)) tile.footprint = fp;

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

async function handleDelete(
    id: string,
    res: ServerResponse,
    catalogPath: string
): Promise<void> {
    if (!ID_RE.test(id)) {
        return sendJson(res, 400, { error: 'bad or missing tile id' });
    }
    try {
        const catalog = await readCatalog(catalogPath);
        const tile = catalog.tiles.find(t => t.id === id);
        if (!tile) return sendJson(res, 404, { error: 'tile not found' });
        // Soft delete: flag the entry, keep the `.vox` file on disk.
        tile.deleted = true;
        await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 4) + '\n');
        sendJson(res, 200, { ok: true, id });
    } catch (err) {
        sendJson(res, 500, { error: `delete failed: ${String(err)}` });
    }
}

/* ── Palette library ──────────────────────────────────────────────────────
 *
 *   GET    /api/palettes       → the saved-palette library (public/voxels/palettes.json)
 *   POST   /api/palettes       → save/upsert a named palette {id,name,colors[]}
 *   DELETE /api/palettes/<id>  → remove a palette from the library
 *
 * Palettes are committed alongside tiles so a whole tileset can share a
 * consistent set of colors across machines.
 */

interface PaletteDef {
    id: string;
    name: string;
    /** Up to 256 slots; null = unassigned. */
    colors: (string | null)[];
}

interface PaletteLib {
    palettes: PaletteDef[];
}

const HEXCOLOR_RE = /^#[0-9a-f]{6}$/i;

export function palettesController(): Plugin {
    return {
        name: 'three-scene-palettes-controller',
        configureServer(server) {
            const palettesPath = path.join(
                server.config.root,
                'public',
                'voxels',
                'palettes.json'
            );
            server.middlewares.use(
                '/api/palettes',
                (req: Connect.IncomingMessage, res: ServerResponse) => {
                    const id = (req.url ?? '').split('?')[0]!.replace(/^\/+/, '');
                    if (req.method === 'GET') {
                        void handleGetPalettes(palettesPath, res);
                    } else if (req.method === 'POST') {
                        void handlePostPalette(req, res, palettesPath);
                    } else if (req.method === 'DELETE') {
                        void handleDeletePalette(id, res, palettesPath);
                    } else {
                        sendJson(res, 405, { error: 'method not allowed' });
                    }
                }
            );
        }
    };
}

async function readPalettes(palettesPath: string): Promise<PaletteLib> {
    try {
        const raw = await fs.readFile(palettesPath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<PaletteLib>;
        return { palettes: parsed.palettes ?? [] };
    } catch {
        return { palettes: [] };
    }
}

async function handleGetPalettes(
    palettesPath: string,
    res: ServerResponse
): Promise<void> {
    sendJson(res, 200, await readPalettes(palettesPath));
}

async function handlePostPalette(
    req: IncomingMessage,
    res: ServerResponse,
    palettesPath: string
): Promise<void> {
    let body: unknown;
    try {
        body = JSON.parse(await readBody(req));
    } catch {
        return sendJson(res, 400, { error: 'invalid JSON body' });
    }

    const { id, name, colors } = (body ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || !ID_RE.test(id)) {
        return sendJson(res, 400, { error: 'bad or missing palette id' });
    }
    if (!Array.isArray(colors)) {
        return sendJson(res, 400, { error: 'missing colors[]' });
    }
    // Normalize to a clean (hex | null) list, capped at 256 slots.
    const clean: (string | null)[] = colors
        .slice(0, 256)
        .map(c => (typeof c === 'string' && HEXCOLOR_RE.test(c) ? c.toLowerCase() : null));

    const palette: PaletteDef = {
        id,
        name: typeof name === 'string' && name ? name : id,
        colors: clean
    };

    try {
        await fs.mkdir(path.dirname(palettesPath), { recursive: true });
        const lib = await readPalettes(palettesPath);
        const idx = lib.palettes.findIndex(p => p.id === id);
        if (idx >= 0) lib.palettes[idx] = palette;
        else lib.palettes.push(palette);
        await fs.writeFile(palettesPath, JSON.stringify(lib, null, 4) + '\n');
        sendJson(res, 200, { ok: true, palette });
    } catch (err) {
        sendJson(res, 500, { error: `write failed: ${String(err)}` });
    }
}

async function handleDeletePalette(
    id: string,
    res: ServerResponse,
    palettesPath: string
): Promise<void> {
    if (!ID_RE.test(id)) {
        return sendJson(res, 400, { error: 'bad or missing palette id' });
    }
    try {
        const lib = await readPalettes(palettesPath);
        const next = lib.palettes.filter(p => p.id !== id);
        if (next.length === lib.palettes.length) {
            return sendJson(res, 404, { error: 'palette not found' });
        }
        await fs.writeFile(
            palettesPath,
            JSON.stringify({ palettes: next }, null, 4) + '\n'
        );
        sendJson(res, 200, { ok: true, id });
    } catch (err) {
        sendJson(res, 500, { error: `delete failed: ${String(err)}` });
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
