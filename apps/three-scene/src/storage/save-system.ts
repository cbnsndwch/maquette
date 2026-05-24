import { CONFIG } from '../config.js';
import type { TileMap } from '../grid/tile-map.js';

/** Persists the terrain grid to localStorage. */
export const SaveSystem = {
    save(tileMap: TileMap): boolean {
        try {
            localStorage.setItem(
                CONFIG.storageKey,
                JSON.stringify(tileMap.serialize())
            );
            return true;
        } catch {
            return false;
        }
    },

    load(tileMap: TileMap): boolean {
        try {
            const raw = localStorage.getItem(CONFIG.storageKey);
            if (!raw) return false;
            return tileMap.load(JSON.parse(raw));
        } catch {
            return false;
        }
    },

    clear(): void {
        try {
            localStorage.removeItem(CONFIG.storageKey);
        } catch {
            // ignore
        }
    }
};
