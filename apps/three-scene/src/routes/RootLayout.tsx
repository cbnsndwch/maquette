import { Outlet } from 'react-router';
import { Toaster } from 'sonner';

import { SceneCanvas } from '@/components/SceneCanvas';
import { TooltipProvider } from '@/components/ui/tooltip';

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
                <div className="title-text">
                    <h1>Maquette • 3D Builder</h1>
                    <p>Scene · Mykonos Biome</p>
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
