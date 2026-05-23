import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        api: {
            port: 5176
        },
        globals: true,
        environment: 'node',
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html']
        }
    }
});
