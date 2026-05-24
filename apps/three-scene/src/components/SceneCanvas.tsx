import { useEffect, useRef } from 'react';

import { getEngine } from '@/bootstrap';

/**
 * Mounts the engine's existing WebGL canvas into the React tree. The renderer is
 * created once in the bootstrap and lives for the page's lifetime — this effect
 * only re-parents the canvas in and out of the DOM, never creating or disposing
 * it, so React StrictMode's double mount/unmount is harmless and navigations
 * between routes never tear down the GL context.
 */
export function SceneCanvas(): React.JSX.Element {
    const mountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount) return;
        const canvas = getEngine().sceneView.renderer.domElement;
        mount.appendChild(canvas);
        return () => {
            if (canvas.parentNode === mount) mount.removeChild(canvas);
        };
    }, []);

    return (
        <div
            ref={mountRef}
            className="fixed inset-0"
            style={{ zIndex: 0 }}
            aria-hidden="true"
        />
    );
}
