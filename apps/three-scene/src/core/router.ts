/**
 * Minimal client-side router built on the browser **Navigation API**
 * (`window.navigation`), with a `history.pushState` + `popstate` fallback for
 * engines that don't expose it yet. No dependency — the app stays vanilla TS.
 *
 * Patterns are slash-delimited with `:name` params, e.g. `/tile/:id`. A handler
 * receives the matched params. Unmatched same-origin navigations are left alone
 * so ordinary links/anchors still work.
 */

export type RouteParams = Record<string, string>;
export type RouteHandler = (params: RouteParams) => void;

interface Route {
    segments: string[];
    handler: RouteHandler;
}

/** The slice of the Navigation API we use (lib.dom doesn't type it yet). */
interface NavigateEvent extends Event {
    canIntercept: boolean;
    hashChange: boolean;
    downloadRequest: string | null;
    destination: { url: string };
    intercept(options: { handler: () => void | Promise<void> }): void;
}
interface NavigationApi extends EventTarget {
    navigate(url: string): unknown;
}

function getNavigation(): NavigationApi | undefined {
    return (window as unknown as { navigation?: NavigationApi }).navigation;
}

export class Router {
    private readonly routes: Route[] = [];
    private current = '';

    /** Register a route. `/tile/:id` captures `id`. Order = priority. */
    register(pattern: string, handler: RouteHandler): this {
        this.routes.push({ segments: splitPath(pattern), handler });
        return this;
    }

    /** The path the router last dispatched (pathname only). */
    get path(): string {
        return this.current;
    }

    /** Begin listening and dispatch the current location. */
    start(): void {
        const nav = getNavigation();
        if (nav) {
            nav.addEventListener('navigate', e =>
                this.onNavigate(e as NavigateEvent)
            );
        } else {
            window.addEventListener('popstate', () =>
                this.dispatch(location.pathname)
            );
        }
        this.dispatch(location.pathname);
    }

    /** Navigate programmatically (push a new history entry). */
    navigate(path: string): void {
        if (path === location.pathname + location.search) {
            this.dispatch(location.pathname);
            return;
        }
        const nav = getNavigation();
        if (nav) {
            nav.navigate(path);
        } else {
            history.pushState({}, '', path);
            this.dispatch(location.pathname);
        }
    }

    private onNavigate(e: NavigateEvent): void {
        if (!e.canIntercept || e.hashChange || e.downloadRequest !== null) {
            return;
        }
        const url = new URL(e.destination.url);
        if (url.origin !== location.origin) return;
        if (!this.match(url.pathname)) return; // not ours — let it through
        e.intercept({ handler: () => this.dispatch(url.pathname) });
    }

    private dispatch(pathname: string): void {
        this.current = pathname;
        const m = this.match(pathname);
        if (m) m.route.handler(m.params);
    }

    private match(
        pathname: string
    ): { route: Route; params: RouteParams } | null {
        const parts = splitPath(pathname);
        for (const route of this.routes) {
            if (route.segments.length !== parts.length) continue;
            const params: RouteParams = {};
            let ok = true;
            for (let i = 0; i < route.segments.length; i++) {
                const seg = route.segments[i]!;
                const part = parts[i]!;
                if (seg.startsWith(':')) {
                    params[seg.slice(1)] = decodeURIComponent(part);
                } else if (seg !== part) {
                    ok = false;
                    break;
                }
            }
            if (ok) return { route, params };
        }
        return null;
    }
}

/** Split a path into non-empty segments (`/` → `[]`, `/tile/x` → `[tile, x]`). */
function splitPath(path: string): string[] {
    return path.split('?')[0]!.split('/').filter(Boolean);
}
