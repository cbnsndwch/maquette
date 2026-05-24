import { randomUUID } from 'node:crypto';

import {
    DEFAULT_GRID,
    PlacementSystem,
    TileMap
} from '@cbnsndwch/scene-author';

/**
 * One in-progress scene the agent is authoring. The {@link TileMap} is mutated
 * across tool calls (server-held session state, PRD §6.4 option a), which maps
 * cleanly onto a Durable Object when this moves to Cloudflare.
 */
export interface SceneSession {
    id: string;
    tileMap: TileMap;
    placement: PlacementSystem;
    biome: string | null;
    prompt: string | null;
    createdAt: string;
}

export interface CreateSceneOptions {
    biome?: string;
    prompt?: string;
    width?: number;
    height?: number;
}

/** In-memory store of active authoring sessions, keyed by scene id. */
export class SessionStore {
    readonly #sessions = new Map<string, SceneSession>();

    create(opts: CreateSceneOptions = {}): SceneSession {
        const width = opts.width ?? DEFAULT_GRID.width;
        const height = opts.height ?? DEFAULT_GRID.height;
        const tileMap = new TileMap(width, height);
        const session: SceneSession = {
            id: randomUUID(),
            tileMap,
            placement: new PlacementSystem(tileMap),
            biome: opts.biome ?? null,
            prompt: opts.prompt ?? null,
            createdAt: new Date().toISOString()
        };
        this.#sessions.set(session.id, session);
        return session;
    }

    get(id: string): SceneSession | undefined {
        return this.#sessions.get(id);
    }

    delete(id: string): boolean {
        return this.#sessions.delete(id);
    }

    get size(): number {
        return this.#sessions.size;
    }
}
