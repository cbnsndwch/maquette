import { Outlet } from "react-router";
import { Toaster } from "sonner";

import { SceneCanvas } from "@/components/SceneCanvas";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * The persistent app shell. The WebGL canvas mounts here once and never unmounts
 * as child routes swap through the <Outlet/>; the global toaster and tooltip
 * provider live here too.
 */
export function RootLayout(): React.JSX.Element {
    return (
        <TooltipProvider>
            <SceneCanvas />

            <header id="title-card">
                <div className="title-text font-semibold flex justify-start items-center gap-1">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="lucide lucide-rotate3d-icon lucide-rotate-3d text-ink-deep size-5"
                    >
                        <path d="m15.194 13.707 3.814 1.86-1.86 3.814" />
                        <path d="M16.47214 7.52786 A 5 10 0 1 0 13 21.79796" />
                        <path d="M21.79796 11 A 10 5 0 1 0 19 15.57071" />
                    </svg>
                    <h1>Maquette</h1>
                    {/* <p>Mykonos Biome</p> */}
                </div>
            </header>

            <Outlet />

            <details id="instructions" aria-label="Controls help">
                <summary className="ins-summary">
                    <span className="ins-badge" aria-hidden="true">
                        ?
                    </span>
                    <span className="ins-summary-label">Controls</span>
                </summary>
                <div className="ins-grid">
                    <span className="key">Click</span>
                    <span>Place selected terrain</span>
                    <span className="key">Drag</span>
                    <span>Brush place across cells</span>
                    <span className="key">Wheel</span>
                    <span>Zoom</span>
                    <span className="key">Ctrl+Wheel</span>
                    <span>Rotate tile (Place mode)</span>
                    <span className="key">Right click</span>
                    <span>Erase cell</span>
                    <span className="key">Right drag</span>
                    <span>Orbit camera</span>
                    <span className="key">Space</span>
                    <span>Hold to pan</span>
                    <span className="key">Ctrl+Z</span>
                    <span>Undo</span>
                    <span className="key">Ctrl+Shift+Z</span>
                    <span>Redo</span>
                    <span className="key">R</span>
                    <span>Rotate tile</span>
                    <span className="key">P / E / H</span>
                    <span>Place / Erase / Pan</span>
                    <span className="key">O / G</span>
                    <span>Auto-rotate / Grid</span>
                    <span className="key">1-4</span>
                    <span>Switch categories</span>
                </div>
            </details>

            <Toaster position="bottom-center" />
        </TooltipProvider>
    );
}
