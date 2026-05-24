/**
 * Client for the dev-server palette library (`/api/palettes`, see
 * vite-tiles-plugin.ts). Saved palettes are shared across tiles so a tileset
 * can keep a consistent set of colors.
 */

export interface SavedPalette {
    id: string;
    name: string;
    /** Up to 256 slots; null = unassigned. */
    colors: (string | null)[];
}

/** Slugify a display name into a valid palette id (`[a-z0-9_-]+`). */
export function paletteId(name: string): string {
    return (
        name
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '_')
            .replace(/^_+|_+$/g, '') || `palette_${Date.now()}`
    );
}

/** The saved-palette library, or an empty list on failure. */
export async function listPalettes(): Promise<SavedPalette[]> {
    try {
        const res = await fetch('/api/palettes');
        if (!res.ok) return [];
        const data = (await res.json()) as { palettes?: SavedPalette[] };
        return data.palettes ?? [];
    } catch {
        return [];
    }
}

/** Save/upsert a palette by id. Returns the stored palette, or null on failure. */
export async function savePalette(
    id: string,
    name: string,
    colors: readonly (string | null)[]
): Promise<SavedPalette | null> {
    try {
        const res = await fetch('/api/palettes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, name, colors })
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { palette?: SavedPalette };
        return data.palette ?? null;
    } catch (err) {
        // oxlint-disable-next-line no-console
        console.error('Failed to save palette:', err);
        return null;
    }
}

/** Remove a palette from the library. Returns true on success. */
export async function deletePalette(id: string): Promise<boolean> {
    try {
        const res = await fetch(`/api/palettes/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
        return res.ok;
    } catch {
        return false;
    }
}
