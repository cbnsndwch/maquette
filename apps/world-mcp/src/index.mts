/* eslint-disable no-console -- a stdio MCP server logs diagnostics to stderr (stdout is the protocol channel) */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { buildServer } from './server.mjs';

async function main(): Promise<void> {
    const server = await buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // stdout is the MCP channel — diagnostics must go to stderr.
    console.error('maquette-world-mcp ready on stdio');
}

main().catch((err: unknown) => {
    console.error('maquette-world-mcp failed to start:', err);
    process.exit(1);
});
