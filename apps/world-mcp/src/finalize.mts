import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    composeSceneVoxels,
    toSceneDocument,
    type SceneDocument,
    type TerrainDef
} from '@cbnsndwch/scene-author';
import { encodeVox } from '@cbnsndwch/world-core';

import type { FsVoxelSource } from './catalog.mjs';
import type { SceneSession } from './sessions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Where finalized artifacts are written (local stand-in for R2). */
export const OUT_DIR =
    process.env.MAQUETTE_MCP_OUT_DIR ?? path.resolve(here, '../.out');

export interface FinalizeResult {
    sceneId: string;
    biome: string | null;
    prompt: string | null;
    catalogVersion: string;
    width: number;
    height: number;
    placedCells: number;
    voxelCount: number;
    document: SceneDocument;
    files: { scene: string; vox: string | null; catalog: string };
}

function countPlaced(doc: SceneDocument): number {
    return doc.terrain.reduce((n, col) => n + col.length, 0);
}

/**
 * Validate + serialize the scene to the canonical document, bake the `.vox`
 * (reusing the editor's composition + encoder), and persist all three artifacts
 * — scene document, baked model, and the pinned catalog snapshot — under the
 * out dir. Mirrors what a Cloudflare deployment will push to R2/D1.
 */
export async function finalizeScene(
    session: SceneSession,
    voxSource: FsVoxelSource,
    catalogVersion: string,
    tiles: readonly TerrainDef[],
    outDir: string = OUT_DIR
): Promise<FinalizeResult> {
    const document = toSceneDocument(session.tileMap);
    const voxels = composeSceneVoxels(session.tileMap, voxSource);

    const dir = path.join(outDir, session.id);
    await mkdir(dir, { recursive: true });

    const scenePath = path.join(dir, 'scene.json');
    await writeFile(scenePath, `${JSON.stringify(document, null, 2)}\n`);

    let voxPath: string | null = null;
    if (voxels.length > 0) {
        voxPath = path.join(dir, 'scene.vox');
        await writeFile(voxPath, Buffer.from(encodeVox(voxels)));
    }

    const catalogPath = path.join(dir, 'catalog.snapshot.json');
    await writeFile(
        catalogPath,
        `${JSON.stringify({ version: catalogVersion, tiles }, null, 2)}\n`
    );

    return {
        sceneId: session.id,
        biome: session.biome,
        prompt: session.prompt,
        catalogVersion,
        width: session.tileMap.width,
        height: session.tileMap.height,
        placedCells: countPlaced(document),
        voxelCount: voxels.length,
        document,
        files: { scene: scenePath, vox: voxPath, catalog: catalogPath }
    };
}
