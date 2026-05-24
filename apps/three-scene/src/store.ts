import { useRef, useSyncExternalStore } from 'react';

/**
 * The engine bridge. The Three.js engine owns all mutable state imperatively;
 * React reads it through this tiny external store. A single version counter is
 * bumped by {@link emit} whenever engine state changes — wired in the bootstrap
 * to the engine's existing `editor.onChange` / `game.ui.update` callbacks, which
 * preserves the engine's single-callback contract with zero `core/` changes.
 *
 * This is `useSyncExternalStore` directly (what Zustand is built on) — no extra
 * dependency, no duplicated/immutable state to keep in sync with the engine.
 */
let version = 0;
const listeners = new Set<() => void>();

/** Bump the version and notify React subscribers. Callable from outside React. */
export function emit(): void {
    version++;
    for (const l of listeners) {
        l();
    }
}

const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

const getVersion = (): number => version;

export const engineStore = { subscribe, getVersion };

/**
 * Read a slice of live engine state, re-rendering only when the selected value
 * changes. Read **scalars** (e.g. `game.tool`, `editor.voxels.length`,
 * `selection.size`) — never snapshot the mutable `voxels`/`palette`/`selection`
 * objects, whose identity never changes. A cached last-value + `isEqual` guard
 * keeps `useSyncExternalStore` stable even if a selector returns a fresh object.
 */
export function useEngineSelector<T>(
    selector: () => T,
    isEqual: (a: T, b: T) => boolean = Object.is
): T {
    const last = useRef<{ has: boolean; value: T }>({
        has: false,
        value: undefined as T
    });
    const getSnapshot = (): T => {
        const next = selector();
        if (last.current.has && isEqual(last.current.value, next)) {
            return last.current.value;
        }
        last.current = { has: true, value: next };
        return next;
    };
    return useSyncExternalStore(subscribe, getSnapshot);
}
