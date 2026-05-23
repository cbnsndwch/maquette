import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        api: {
            port: 5177
        },
        globals: true,
        environment: 'node'
    }
});
