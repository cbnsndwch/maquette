import { defineConfig, loadEnv } from 'vite';

const MB_USER_AGENT = 'Musicologia-maquette/0.1 ( https://musicologia.de )';

// Dev-only proxies so the browser never sees the admin key (or has to forge the
// MusicBrainz User-Agent, a forbidden header in browsers):
//  - /api/* -> musicologia.de, with x-api-key injected server-side
//  - /mb/*  -> musicbrainz.org/ws/2, with a proper User-Agent injected
// Production would route these through its own backend instead.
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const apiKey = env.MUSICOLOGIA_API_KEY ?? '';

    return {
        server: {
            port: 8301,
            proxy: {
                '/api': {
                    target: 'https://musicologia.de',
                    changeOrigin: true,
                    headers: apiKey ? { 'x-api-key': apiKey } : {}
                },
                '/mb': {
                    target: 'https://musicbrainz.org',
                    changeOrigin: true,
                    rewrite: path => path.replace(/^\/mb/, '/ws/2'),
                    headers: { 'User-Agent': MB_USER_AGENT }
                }
            }
        }
    };
});
