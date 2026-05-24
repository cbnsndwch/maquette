import { z } from 'zod';

import type { TileMap } from './tile-map.mjs';

/**
 * The canonical scene document — the interop contract that makes a generated
 * scene render identically to a hand-built one. It is byte-for-byte what the
 * editor's save system persists and what {@link TileMap.load} accepts:
 *
 * ```jsonc
 * {
 *   "width": 14,
 *   "height": 14,
 *   "terrain": [ // width*height columns, each a bottom→top array of cells
 *     [ { "id": "grass", "rot": 0 }, { "id": "boulder", "rot": 2 } ],
 *     []
 *   ]
 * }
 * ```
 *
 * Any drift between this schema and the editor's format breaks parity, so the
 * schema lives here in the shared core and both sides depend on it.
 */

export const rotationSchema = z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3)
]);

export const terrainCellSchema = z.object({
    id: z.string(),
    rot: rotationSchema
});

export const sceneDocumentSchema = z
    .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        terrain: z.array(z.array(terrainCellSchema))
    })
    .refine(d => d.terrain.length === d.width * d.height, {
        message: 'terrain must hold exactly width*height columns'
    });

export type SceneDocument = z.infer<typeof sceneDocumentSchema>;

/**
 * Parse + validate an unknown value as a {@link SceneDocument}. Returns the
 * typed document on success, or a list of human-readable issues on failure —
 * the shape the MCP server returns to an agent.
 */
export function parseSceneDocument(
    value: unknown
): { ok: true; document: SceneDocument } | { ok: false; errors: string[] } {
    const result = sceneDocumentSchema.safeParse(value);
    if (result.success) return { ok: true, document: result.data };
    return {
        ok: false,
        errors: result.error.issues.map(
            i => `${i.path.join('.') || '<root>'}: ${i.message}`
        )
    };
}

/** Serialize a {@link TileMap} into the canonical scene document. */
export function toSceneDocument(tileMap: TileMap): SceneDocument {
    return tileMap.serialize();
}
