import {
    ASSET_INDEX,
    CATEGORIES,
    composeSceneVoxels,
    DEFAULT_GRID,
    footprintOf,
    GROUND_LAYERS,
    TERRAIN_MANIFEST,
    VOXEL_PER_TILE,
    type Category,
    type Rotation
} from '@cbnsndwch/scene-author';
import { encodeVox, type Voxel } from '@cbnsndwch/world-core';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { computeCatalogVersion, loadCatalogFromDisk, type FsVoxelSource } from './catalog.mjs';
import { finalizeScene } from './finalize.mjs';
import { renderVoxels, renderVoxelsMultiView } from './render.mjs';
import type { SceneSession, SessionStore } from './sessions.mjs';
import {
    analyzeTile,
    buildShape,
    type TileBuilderStore,
    type TileShape
} from './tile-builder.mjs';
import {
    saveTileToDisk,
    slugifyTileId,
    softDeleteTileOnDisk,
    TILE_ID_RE
} from './tile-store.mjs';

export interface ToolDeps {
    sessions: SessionStore;
    tileBuilders: TileBuilderStore;
    voxSource: FsVoxelSource;
    publicDir: string;
    outDir: string;
}

function json(
    payload: Record<string, unknown>,
    isError = false
): CallToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
        ...(isError ? { isError: true } : {})
    };
}

/** Tool result carrying an isometric PNG preview plus its metadata. */
function image(
    pngBase64: string,
    meta: Record<string, unknown>
): CallToolResult {
    return {
        content: [
            { type: 'image', data: pngBase64, mimeType: 'image/png' },
            { type: 'text', text: JSON.stringify(meta, null, 2) }
        ],
        structuredContent: meta
    };
}

const STACKING_RULE =
    'A cell may start any empty column. Stacking onto an existing column ' +
    'requires the supporting top cell to be stackable; non-stackable tops ' +
    '(e.g. sea wall, props) reject anything placed on them.';

const resolutionSchema = z.number().int().min(64).max(1024).default(512);

const N = VOXEL_PER_TILE;
const categorySchema = z.enum(['terrain', 'nature', 'props', 'buildings']);
const hexColor = z
    .string()
    .regex(
        /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
        'must be a hex color like #7eaa5f'
    );
const coord = z.number().int().min(-64).max(64);
const size = z.number().int().min(1).max(64);
const footprintSchema = z
    .tuple([z.number().int().min(1).max(8), z.number().int().min(1).max(8)])
    .describe('Grid footprint [w, d] in cells (default [1, 1])');
const tileResolutionSchema = z
    .union([z.literal(12), z.literal(24), z.literal(36), z.literal(48)])
    .describe(
        'Per-asset resolution r (voxels per cell edge, default 12). Higher r ' +
            'authors finer cubes in the same world cell; grid is (r·w) × (r·d).'
    );

function liveTiles() {
    return [...TERRAIN_MANIFEST];
}

/** Register the full scene + tile authoring tool surface on an MCP server. */
export function registerTools(server: McpServer, deps: ToolDeps): void {
    const { sessions, tileBuilders, voxSource, publicDir, outDir } = deps;

    const needScene = (
        sceneId: string,
        run: (session: SceneSession) => CallToolResult | Promise<CallToolResult>
    ): CallToolResult | Promise<CallToolResult> => {
        const session = sessions.get(sceneId);
        if (!session) {
            return json({ ok: false, error: 'unknown_scene', sceneId }, true);
        }
        return run(session);
    };

    /* ── Catalog & grid ──────────────────────────────────────────── */

    server.registerTool(
        'list_catalog',
        {
            title: 'List tile catalog',
            description:
                'List every placeable tile with its id, display name, category ' +
                'and whether it is stackable. These ids are the vocabulary for ' +
                'place_tile / fill_terrain. Reflects tiles authored via save_tile. ' +
                'Includes the live catalogVersion.',
            inputSchema: {}
        },
        () => {
            const tiles = liveTiles();
            return json({
                catalogVersion: computeCatalogVersion(tiles),
                count: tiles.length,
                categories: CATEGORIES,
                tiles: tiles.map(t => ({
                    id: t.id,
                    name: t.name,
                    category: t.category,
                    stackable: t.stackable,
                    footprint: footprintOf(t.id),
                    resolution: t.resolution ?? VOXEL_PER_TILE
                }))
            });
        }
    );

    server.registerTool(
        'reload_catalog',
        {
            title: 'Reload tile catalog from disk',
            description:
                'Re-read catalog.json from disk and reload all tile voxels into the ' +
                'live server. Call after adding or un-deleting entries in catalog.json ' +
                'or dropping new .vox files into voxels/terrain/. Returns the refreshed ' +
                'tile list and new catalogVersion.',
            inputSchema: {}
        },
        async () => {
            const tiles = await loadCatalogFromDisk(publicDir);
            await voxSource.preload(tiles);
            return json({
                ok: true,
                count: tiles.length,
                catalogVersion: computeCatalogVersion(tiles),
                tiles: tiles.map(t => ({
                    id: t.id,
                    name: t.name,
                    category: t.category,
                    stackable: t.stackable,
                    footprint: footprintOf(t.id),
                    resolution: t.resolution ?? VOXEL_PER_TILE
                }))
            });
        }
    );

    server.registerTool(
        'get_grid_info',
        {
            title: 'Get grid info & placement rules',
            description:
                'Return the default grid footprint, the legal rotations, the tile ' +
                'categories, and the placement rules an agent must respect.',
            inputSchema: {}
        },
        () =>
            json({
                defaultGrid: {
                    width: DEFAULT_GRID.width,
                    height: DEFAULT_GRID.height
                },
                rotations: [0, 1, 2, 3],
                categories: CATEGORIES,
                rules: {
                    bounds: '0 <= gx < width and 0 <= gy < height',
                    stacking: STACKING_RULE,
                    rotation: 'rot is a quarter-turn: 0, 1, 2 or 3',
                    footprint:
                        'A tile may declare a w×d cell footprint (default 1×1). ' +
                        'A multi-cell building anchors at (gx, gy) and reserves ' +
                        'its rotated footprint (w×d becomes d×w at rot 1 or 3) as ' +
                        'one unit: every covered cell must be in bounds, free of ' +
                        'other buildings, and on one level terrain surface, else ' +
                        'the placement rejects with out_of_bounds / occupied / ' +
                        'not_level. Erasing any covered cell removes the building.',
                    resolution:
                        'A tile may declare a per-asset resolution r (voxels per ' +
                        'cell edge: 12 default, or 24/36/48) for finer detail in ' +
                        'the same world cell — terrain stays at 12. Placement and ' +
                        'footprint rules are unchanged by r; mixed resolutions ' +
                        'coexist in one scene and bake onto a common .vox grid.'
                }
            })
    );

    /* ── Scene authoring ─────────────────────────────────────────── */

    server.registerTool(
        'create_scene',
        {
            title: 'Create a scene',
            description:
                'Start a new authoring session for a scene. Returns a sceneId to ' +
                'pass to every subsequent tool. Width/height default to the ' +
                'standard grid when omitted.',
            inputSchema: {
                biome: z
                    .string()
                    .optional()
                    .describe('Target biome label, e.g. "mykonos"'),
                prompt: z
                    .string()
                    .optional()
                    .describe('Plain-English description guiding the scene'),
                width: z.number().int().positive().optional(),
                height: z.number().int().positive().optional()
            }
        },
        args => {
            const session = sessions.create(args);
            return json({
                ok: true,
                sceneId: session.id,
                width: session.tileMap.width,
                height: session.tileMap.height,
                biome: session.biome,
                prompt: session.prompt,
                createdAt: session.createdAt
            });
        }
    );

    server.registerTool(
        'place_tile',
        {
            title: 'Place a tile',
            description:
                'Place a tile at (gx, gy). A single-cell tile pushes onto the ' +
                'column top; a multi-cell building anchors its footprint at ' +
                '(gx, gy) and reserves every covered cell as one unit. Rejects ' +
                'illegal placements with a machine-readable reason (unknown_tile, ' +
                'out_of_bounds, not_stackable, occupied, not_level) so you can ' +
                'self-correct.',
            inputSchema: {
                sceneId: z.string(),
                id: z.string().describe('Tile id from list_catalog'),
                gx: z.number().int(),
                gy: z.number().int(),
                rot: z.number().int().min(0).max(3).default(0)
            }
        },
        ({ sceneId, id, gx, gy, rot }) =>
            needScene(sceneId, session => {
                const check = session.placement.checkPlace(
                    id,
                    gx,
                    gy,
                    rot as Rotation
                );
                if (!check.ok) {
                    return json(
                        {
                            ok: false,
                            error: check.reason,
                            sceneId,
                            id,
                            gx,
                            gy,
                            rot
                        },
                        true
                    );
                }
                const result = session.placement.place(
                    id,
                    gx,
                    gy,
                    rot as Rotation
                );
                const placed =
                    result?.kind === 'building'
                        ? {
                              id,
                              ax: result.ax,
                              ay: result.ay,
                              rot,
                              baseLevel: result.baseLevel,
                              footprint: footprintOf(id)
                          }
                        : { id, gx, gy, rot, level: result?.level ?? 0 };
                return json({
                    ok: true,
                    sceneId,
                    placed,
                    stackHeight: session.tileMap.stackHeight(gx, gy)
                });
            })
    );

    server.registerTool(
        'erase_cell',
        {
            title: 'Erase the top cell',
            description: 'Pop the top cell off the column at (gx, gy).',
            inputSchema: {
                sceneId: z.string(),
                gx: z.number().int(),
                gy: z.number().int()
            }
        },
        ({ sceneId, gx, gy }) =>
            needScene(sceneId, session => {
                const removed = session.placement.erase(gx, gy);
                return json({
                    ok: true,
                    sceneId,
                    removed,
                    stackHeight: session.tileMap.stackHeight(gx, gy)
                });
            })
    );

    server.registerTool(
        'fill_terrain',
        {
            title: 'Fill empty cells with terrain',
            description:
                'Carpet every empty column with one terrain tile at the given ' +
                'rotation (mirrors the editor fill). Occupied columns are left alone.',
            inputSchema: {
                sceneId: z.string(),
                id: z.string().describe('Tile id to carpet with'),
                rot: z.number().int().min(0).max(3).default(0)
            }
        },
        ({ sceneId, id, rot }) =>
            needScene(sceneId, session => {
                if (!ASSET_INDEX[id]) {
                    return json(
                        { ok: false, error: 'unknown_tile', sceneId, id },
                        true
                    );
                }
                const { tileMap, placement } = session;
                let filled = 0;
                for (let gy = 0; gy < tileMap.height; gy++) {
                    for (let gx = 0; gx < tileMap.width; gx++) {
                        if (tileMap.stackHeight(gx, gy) > 0) continue;
                        if (placement.place(id, gx, gy, rot as Rotation)) {
                            filled++;
                        }
                    }
                }
                return json({ ok: true, sceneId, id, filled });
            })
    );

    server.registerTool(
        'can_place',
        {
            title: 'Probe a placement',
            description:
                'Check whether a tile could be placed at (gx, gy) without ' +
                'mutating the scene. For a multi-cell building, pass rot to probe ' +
                'the rotated footprint. Returns ok, or a rejection reason.',
            inputSchema: {
                sceneId: z.string(),
                id: z.string(),
                gx: z.number().int(),
                gy: z.number().int(),
                rot: z.number().int().min(0).max(3).default(0)
            }
        },
        ({ sceneId, id, gx, gy, rot }) =>
            needScene(sceneId, session =>
                json({
                    sceneId,
                    id,
                    gx,
                    gy,
                    rot,
                    ...session.placement.checkPlace(id, gx, gy, rot as Rotation)
                })
            )
    );

    server.registerTool(
        'get_cell',
        {
            title: 'Read a column',
            description:
                'Return the bottom→top stack of cells at (gx, gy) and its height.',
            inputSchema: {
                sceneId: z.string(),
                gx: z.number().int(),
                gy: z.number().int()
            }
        },
        ({ sceneId, gx, gy }) =>
            needScene(sceneId, session => {
                const inBounds = session.tileMap.inBounds(gx, gy);
                const stack = session.tileMap.getStack(gx, gy);
                return json({
                    sceneId,
                    gx,
                    gy,
                    inBounds,
                    height: stack.length,
                    stack: stack.map(c => ({ id: c.id, rot: c.rot }))
                });
            })
    );

    server.registerTool(
        'get_scene',
        {
            title: 'Read the full scene',
            description:
                'Return the full canonical scene document (the exact format the ' +
                'editor saves and loads) plus a count of placed cells.',
            inputSchema: { sceneId: z.string() }
        },
        ({ sceneId }) =>
            needScene(sceneId, session => {
                const document = session.tileMap.serialize();
                const placedCells = document.terrain.reduce(
                    (n, col) => n + col.length,
                    0
                );
                return json({
                    sceneId,
                    biome: session.biome,
                    prompt: session.prompt,
                    placedCells,
                    document
                });
            })
    );

    server.registerTool(
        'finalize_scene',
        {
            title: 'Finalize & persist the scene',
            description:
                'Validate and serialize the scene, bake a .vox model, and persist ' +
                'the document, the model and a pinned catalog snapshot. Returns the ' +
                'document, artifact paths and stats. Loads identically in the editor.',
            inputSchema: { sceneId: z.string() }
        },
        ({ sceneId }) =>
            needScene(sceneId, async session => {
                const tiles = liveTiles();
                try {
                    const result = await finalizeScene(
                        session,
                        voxSource,
                        computeCatalogVersion(tiles),
                        tiles,
                        outDir
                    );
                    return json({ ok: true, ...result });
                } catch (err) {
                    // Most likely the mixed-resolution bake overflowed the
                    // 256-voxel axis cap (PRD §5.3) — surface it machine-readably.
                    return json(
                        {
                            ok: false,
                            error: 'scene_too_large',
                            sceneId,
                            message:
                                err instanceof Error ? err.message : String(err)
                        },
                        true
                    );
                }
            })
    );

    server.registerTool(
        'render_scene',
        {
            title: 'Render an isometric preview of the scene',
            description:
                'Bake the scene to voxels and return an isometric PNG preview so ' +
                'you can SEE the result and self-correct. Headless (no browser). ' +
                'resolution is the square pixel size (64..512).',
            inputSchema: { sceneId: z.string(), resolution: resolutionSchema }
        },
        ({ sceneId, resolution }) =>
            needScene(sceneId, async session => {
                const voxels = composeSceneVoxels(session.tileMap, voxSource);
                if (voxels.length === 0) {
                    return json(
                        { ok: false, error: 'empty_scene', sceneId },
                        true
                    );
                }
                const r = await renderVoxels(voxels, resolution);
                return image(r.pngBase64, {
                    sceneId,
                    voxelCount: r.voxelCount,
                    width: r.width,
                    height: r.height
                });
            })
    );

    /* ── Tile authoring ──────────────────────────────────────────── */

    const needTile = (
        tileSessionId: string,
        run: (
            builder: NonNullable<ReturnType<TileBuilderStore['get']>>
        ) => CallToolResult | Promise<CallToolResult>
    ): CallToolResult | Promise<CallToolResult> => {
        const builder = tileBuilders.get(tileSessionId);
        if (!builder) {
            return json(
                { ok: false, error: 'unknown_tile_session', tileSessionId },
                true
            );
        }
        return run(builder);
    };

    server.registerTool(
        'create_tile',
        {
            title: 'Create a tile',
            description:
                `Start a tile-builder session. A tile occupies a w×d block of grid ` +
                `cells (default 1×1) at resolution r (voxels per cell edge, ` +
                `default ${N}), authored at (r·w) × (r·d) voxels, variable height; ` +
                'z rises from 0 (the bottom layers sit below scene ground). Pass ' +
                'footprint [w, d] for multi-cell buildings (e.g. [2,2] house, ' +
                '[3,2] terrace) and resolution (12/24/36/48) for finer detail in ' +
                'the same world cell. Build it with add_shape / add_voxels, check ' +
                'with get_tile_info, then save_tile. Returns a tileSessionId.',
            inputSchema: {
                name: z.string().optional(),
                id: z
                    .string()
                    .optional()
                    .describe('Tile id (a-z0-9_-); defaults to a slug of name'),
                category: categorySchema.optional(),
                stackable: z
                    .boolean()
                    .optional()
                    .describe(
                        'Can other tiles stack on top? defaults per category'
                    ),
                footprint: footprintSchema.optional(),
                resolution: tileResolutionSchema.optional()
            }
        },
        args => {
            const builder = tileBuilders.create(args);
            const [fw, fd] = builder.meta.footprint;
            const r = builder.meta.resolution;
            const nx = fw * r;
            const ny = fd * r;
            return json({
                ok: true,
                tileSessionId: builder.id,
                footprint: { cells: [fw, fd], width: nx, height: ny },
                resolution: r,
                conventions: {
                    axes: `x in 0..${nx - 1}, y in 0..${ny - 1} on the ground plane, z up`,
                    groundLayers: GROUND_LAYERS * (r / N),
                    colorLimit: 255
                },
                meta: builder.meta
            });
        }
    );

    server.registerTool(
        'add_shape',
        {
            title: 'Add a shape to the tile',
            description:
                'Append a primitive to the current tile. box/shell/pyramid use ' +
                '(x,y,z) near-bottom corner + (w,d,h); dome/cylinder use (cx,cy,z) ' +
                'center + radius (cylinder also h). Voxels at a shared position are ' +
                'overwritten by later shapes. Reports footprint overflow as warnings.',
            inputSchema: {
                tileSessionId: z.string(),
                shape: z.enum(['box', 'shell', 'dome', 'cylinder', 'pyramid']),
                color: hexColor,
                x: coord.optional(),
                y: coord.optional(),
                z: coord.optional(),
                w: size.optional(),
                d: size.optional(),
                h: size.optional(),
                cx: coord.optional(),
                cy: coord.optional(),
                radius: z.number().int().min(1).max(32).optional(),
                floor: z.boolean().optional(),
                roof: z.boolean().optional(),
                sides: z.boolean().optional()
            }
        },
        ({ tileSessionId, shape, color, ...params }) =>
            needTile(tileSessionId, builder => {
                let voxels: Voxel[];
                try {
                    voxels = buildShape(shape as TileShape, params, color);
                } catch (err) {
                    return json(
                        {
                            ok: false,
                            error: 'bad_shape_params',
                            shape,
                            message:
                                err instanceof Error ? err.message : String(err)
                        },
                        true
                    );
                }
                builder.add(voxels);
                const a = analyzeTile(
                    builder.materialize(),
                    builder.meta.footprint,
                    builder.meta.resolution
                );
                return json({
                    ok: true,
                    tileSessionId,
                    shape,
                    added: voxels.length,
                    voxelCount: a.voxelCount,
                    dims: a.dims,
                    colorCount: a.colorCount,
                    outOfFootprint: a.outOfFootprint,
                    warnings: a.errors
                });
            })
    );

    server.registerTool(
        'add_voxels',
        {
            title: 'Add raw voxels to the tile',
            description:
                'Append individual voxels (the escape hatch for fine detail shapes ' +
                "can't express). Each is {x, y, z, color}. Voxels at a shared " +
                'position are overwritten by later writes.',
            inputSchema: {
                tileSessionId: z.string(),
                voxels: z
                    .array(
                        z.object({
                            x: z.number().int(),
                            y: z.number().int(),
                            z: z.number().int(),
                            color: hexColor
                        })
                    )
                    .min(1)
                    .max(5000)
            }
        },
        ({ tileSessionId, voxels }) =>
            needTile(tileSessionId, builder => {
                builder.add(
                    voxels.map(v => ({ x: v.x, y: v.y, z: v.z, c: v.color }))
                );
                const a = analyzeTile(
                    builder.materialize(),
                    builder.meta.footprint,
                    builder.meta.resolution
                );
                return json({
                    ok: true,
                    tileSessionId,
                    added: voxels.length,
                    voxelCount: a.voxelCount,
                    dims: a.dims,
                    colorCount: a.colorCount,
                    outOfFootprint: a.outOfFootprint,
                    warnings: a.errors
                });
            })
    );

    server.registerTool(
        'clear_tile',
        {
            title: 'Clear the tile',
            description:
                'Discard all voxels in the tile-builder session (start over).',
            inputSchema: { tileSessionId: z.string() }
        },
        ({ tileSessionId }) =>
            needTile(tileSessionId, builder => {
                builder.clear();
                return json({ ok: true, tileSessionId, voxelCount: 0 });
            })
    );

    server.registerTool(
        'get_tile_info',
        {
            title: 'Inspect the tile',
            description:
                'Return the current voxel count, baked dimensions, color count and ' +
                'any blocking issues. `ready` is true when the tile can be saved.',
            inputSchema: { tileSessionId: z.string() }
        },
        ({ tileSessionId }) =>
            needTile(tileSessionId, builder => {
                const a = analyzeTile(
                    builder.materialize(),
                    builder.meta.footprint,
                    builder.meta.resolution
                );
                return json({
                    tileSessionId,
                    voxelCount: a.voxelCount,
                    dims: a.dims,
                    colorCount: a.colorCount,
                    outOfFootprint: a.outOfFootprint,
                    footprint: builder.meta.footprint,
                    resolution: builder.meta.resolution,
                    ready: a.errors.length === 0,
                    issues: a.errors,
                    meta: builder.meta
                });
            })
    );

    server.registerTool(
        'render_tile',
        {
            title: 'Render an isometric preview of the tile',
            description:
                'Return an isometric PNG preview of the tile you are building so ' +
                'you can SEE it and compare against a reference, then adjust shapes ' +
                'and re-render. Headless (no browser). Returns a 2×2 composite of ' +
                'four 90°-rotated isometric views (NE top-left, NW top-right, ' +
                'SW bottom-left, SE bottom-right) so all four faces are visible. ' +
                'Tip: pick flat base colors — the renderer adds its own top/side ' +
                'shading, so do not paint shadows in.',
            inputSchema: {
                tileSessionId: z.string(),
                resolution: resolutionSchema
            }
        },
        ({ tileSessionId, resolution }) =>
            needTile(tileSessionId, async builder => {
                const voxels = builder.materialize();
                if (voxels.length === 0) {
                    return json(
                        { ok: false, error: 'empty_tile', tileSessionId },
                        true
                    );
                }
                // panelRes: each of the 4 sub-views; composite output is 2× that.
                const panelRes = Math.max(64, Math.min(512, Math.round(resolution / 2)));
                const r = await renderVoxelsMultiView(voxels, panelRes);
                // Save to disk so the user can open the file directly.
                const rendersDir = join(publicDir, 'renders');
                await mkdir(rendersDir, { recursive: true });
                const outPath = join(rendersDir, `${tileSessionId}.png`);
                await writeFile(outPath, Buffer.from(r.pngBase64, 'base64'));
                return image(r.pngBase64, {
                    tileSessionId,
                    voxelCount: r.voxelCount,
                    width: r.width,
                    height: r.height,
                    layout: '2x2 composite: NE top-left, NW top-right, SW bottom-left, SE bottom-right',
                    savedTo: outPath
                });
            })
    );

    server.registerTool(
        'save_tile',
        {
            title: 'Save the tile to the catalog',
            description:
                'Bake the tile to a .vox, write it under the editor catalog and ' +
                'upsert its entry. The tile is immediately placeable via place_tile ' +
                'and shows up in list_catalog and the editor palette. Rejects an ' +
                'invalid tile (empty, out-of-footprint, too many colors) with issues.',
            inputSchema: {
                tileSessionId: z.string(),
                id: z
                    .string()
                    .optional()
                    .describe(
                        'Tile id (a-z0-9_-); defaults to the session id/name'
                    ),
                name: z.string().optional(),
                category: categorySchema.optional(),
                stackable: z.boolean().optional(),
                footprint: footprintSchema.optional(),
                resolution: tileResolutionSchema.optional()
            }
        },
        ({ tileSessionId, id, name, category, stackable, footprint, resolution }) =>
            needTile(tileSessionId, async builder => {
                const finalName =
                    name ??
                    builder.meta.name ??
                    id ??
                    builder.meta.id ??
                    'untitled';
                const resolvedId =
                    id ?? builder.meta.id ?? slugifyTileId(finalName);
                if (!resolvedId || !TILE_ID_RE.test(resolvedId)) {
                    return json(
                        { ok: false, error: 'bad_tile_id', id: resolvedId },
                        true
                    );
                }
                const resolvedCategory: Category =
                    category ?? builder.meta.category;
                const resolvedStackable = stackable ?? builder.meta.stackable;
                const resolvedFootprint: [number, number] =
                    footprint ?? builder.meta.footprint;
                const resolvedResolution =
                    resolution ?? builder.meta.resolution;

                const voxels = builder.materialize();
                const a = analyzeTile(
                    voxels,
                    resolvedFootprint,
                    resolvedResolution
                );
                if (a.errors.length > 0) {
                    return json(
                        {
                            ok: false,
                            error: 'invalid_tile',
                            issues: a.errors,
                            voxelCount: a.voxelCount,
                            dims: a.dims,
                            colorCount: a.colorCount
                        },
                        true
                    );
                }

                let vox: ArrayBuffer;
                try {
                    vox = encodeVox(voxels, a.dims);
                } catch (err) {
                    return json(
                        {
                            ok: false,
                            error: 'encode_failed',
                            message:
                                err instanceof Error ? err.message : String(err)
                        },
                        true
                    );
                }

                const def = await saveTileToDisk(
                    publicDir,
                    {
                        id: resolvedId,
                        name: finalName,
                        category: resolvedCategory,
                        stackable: resolvedStackable,
                        footprint: resolvedFootprint,
                        resolution: resolvedResolution
                    },
                    vox
                );
                voxSource.set(def.id, voxels, a.dims);

                // Re-point the builder so further saves overwrite in place.
                builder.meta = {
                    id: def.id,
                    name: def.name,
                    category: def.category,
                    stackable: def.stackable,
                    footprint: resolvedFootprint,
                    resolution: resolvedResolution
                };

                return json({
                    ok: true,
                    tile: def,
                    voxelCount: voxels.length,
                    dims: a.dims,
                    colorCount: a.colorCount,
                    footprint: resolvedFootprint,
                    resolution: resolvedResolution,
                    file: def.file
                });
            })
    );

    server.registerTool(
        'delete_tile',
        {
            title: 'Delete a tile',
            description:
                'Soft-delete a catalog tile by id: the entry is flagged deleted and ' +
                'the .vox is kept on disk (reversible by hand). Drops it from the ' +
                'live catalog so it is no longer placeable.',
            inputSchema: { id: z.string() }
        },
        async ({ id }) => {
            const deleted = await softDeleteTileOnDisk(publicDir, id);
            if (!deleted) {
                return json({ ok: false, error: 'not_found', id }, true);
            }
            return json({ ok: true, id, deleted: true });
        }
    );
}
