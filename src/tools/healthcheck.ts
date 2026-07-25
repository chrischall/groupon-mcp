import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textResult } from '@chrischall/mcp-utils';
import { VERSION } from '../version.js';

// Read-path MVP placeholder. Registering at least one tool is what makes the
// server advertise the `tools` capability, so the host's install-time
// `tools/list` smoke test succeeds. A later phase replaces this with real
// Groupon deal-read tools and upgrades this into a live endpoint probe.
export function registerHealthcheckTools(server: McpServer): void {
  server.registerTool(
    'groupon_healthcheck',
    {
      description: 'Report that the groupon-mcp server is running and its version. Deal-read tools arrive in a later phase.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {},
    },
    async () =>
      textResult({
        ok: true,
        server: 'groupon-mcp',
        version: VERSION,
        status: 'read-path MVP — deal-read tools not yet registered',
      }),
  );
}
