import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { initEngine } from './bootstrap.js';
import { createAppRouter } from './router.js';

import './index.css';

// The engine (WebGL renderer, assets, catalog) must exist before any route
// loader or component reads it, so initialize it once, then build the router
// (whose initial-route loader reads the engine) and mount React.
const engine = await initEngine();
const router = createAppRouter();

const rootEl = document.getElementById('root')!;
createRoot(rootEl).render(
    <StrictMode>
        <RouterProvider router={router} />
    </StrictMode>
);

// Surface the engine + router for debugging in the dev console.
if (import.meta.env.DEV) {
    Object.assign(window as unknown as Record<string, unknown>, {
        engine,
        router
    });
}
