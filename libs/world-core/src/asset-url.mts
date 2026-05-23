/**
 * Platform-agnostic asset URL resolution.
 *
 * The same scene code runs in three places that disagree about how to address a
 * local file: the browser wants a public URL, a Tauri webview must go through
 * `convertFileSrc()` / the asset protocol (a raw `fetch('/assets/x')` fails —
 * tauri-apps/tauri discussion #5045), and a terminal/Node host wants a `file://`
 * path. Rather than scatter that branching through the renderer, code calls
 * {@link assetUrl} and each host installs the right resolver once at startup.
 */

export type AssetResolver = (path: string) => string;

/** Browser/default behaviour: pass the path through unchanged. */
const identityResolver: AssetResolver = path => path;

let resolver: AssetResolver = identityResolver;

/**
 * Install the host's asset resolver. Call once at startup, e.g. in Tauri:
 * `setAssetResolver(convertFileSrc)`.
 */
export function setAssetResolver(next: AssetResolver): void {
    resolver = next;
}

/** Reset to the default pass-through resolver (useful in tests). */
export function resetAssetResolver(): void {
    resolver = identityResolver;
}

/** Resolve an asset path to a URL usable by the current host. */
export function assetUrl(path: string): string {
    return resolver(path);
}
