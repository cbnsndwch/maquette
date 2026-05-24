import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { FsVoxelSource, loadCatalogFromDisk, PUBLIC_DIR } from './catalog.mjs';
import { OUT_DIR } from './finalize.mjs';
import { SessionStore } from './sessions.mjs';
import { TileBuilderStore } from './tile-builder.mjs';
import { registerTools } from './tools.mjs';

export interface BuildServerOptions {
    /** Editor public dir holding voxels/catalog.json + voxels/terrain/*.vox. */
    publicDir?: string;
    /** Where finalized scenes are written. */
    outDir?: string;
}

/**
 * Build a fully-wired MCP server: loads the on-disk tile catalog, preloads its
 * `.vox` assets for baking, and registers the scene + tile authoring tools.
 * Transport is the caller's choice (stdio for local, in-memory for tests,
 * HTTP later). `publicDir`/`outDir` are injectable so tests can isolate writes.
 */
export async function buildServer(
    opts: BuildServerOptions = {}
): Promise<McpServer> {
    const publicDir = opts.publicDir ?? PUBLIC_DIR;
    const outDir = opts.outDir ?? OUT_DIR;

    const tiles = await loadCatalogFromDisk(publicDir);
    const voxSource = new FsVoxelSource(publicDir);
    await voxSource.preload(tiles);

    const server = new McpServer(
        { name: 'maquette-world-mcp', version: '0.0.0' },
        {
            capabilities: { tools: {} },
            instructions:
                'Authoring tools for the maquette voxel world. Compose SCENES ' +
                'over the tile catalog (list_catalog, get_grid_info, create_scene, ' +
                'place/fill/erase, finalize_scene), and author new TILES from shape ' +
                'primitives (create_tile, add_shape, add_voxels, get_tile_info, ' +
                'save_tile) — a saved tile is instantly placeable. Every mutating ' +
                'tool returns a structured success or a machine-readable error so ' +
                'you can self-correct.'
        }
    );

    registerTools(server, {
        sessions: new SessionStore(),
        tileBuilders: new TileBuilderStore(),
        voxSource,
        publicDir,
        outDir
    });

    return server;
}
