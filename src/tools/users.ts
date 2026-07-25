import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textResult } from '@chrischall/mcp-utils';
import type { SetlistClient } from '../client.js';
import { ATTRIBUTION_NOTE } from '../attribution.js';

const page = z
  .number()
  .int()
  .positive()
  .optional()
  .describe('Result page number (defaults to 1)');

export function registerUserTools(server: McpServer, client: SetlistClient): void {
  server.registerTool(
    'setlist_get_user',
    {
      description:
        "Get a setlist.fm user's public profile by their userId (their setlist.fm username)." +
        ATTRIBUTION_NOTE,
      annotations: { readOnlyHint: true },
      inputSchema: {
        userId: z.string().describe('setlist.fm userId (username)'),
      },
    },
    async ({ userId }) => {
      const data = await client.request('GET', `/1.0/user/${encodeURIComponent(userId)}`);
      return textResult(data);
    },
  );

  server.registerTool(
    'setlist_get_user_attended',
    {
      description:
        "Get the concerts a setlist.fm user has marked as attended. Paginated via `p`." +
        ATTRIBUTION_NOTE,
      annotations: { readOnlyHint: true },
      inputSchema: {
        userId: z.string().describe('setlist.fm userId (username)'),
        p: page,
      },
    },
    async ({ userId, p }) => {
      const data = await client.request(
        'GET',
        `/1.0/user/${encodeURIComponent(userId)}/attended`,
        { query: { p } },
      );
      return textResult(data);
    },
  );

  server.registerTool(
    'setlist_get_user_edited',
    {
      description:
        "Get the setlists a setlist.fm user has created or edited. Paginated via `p`." +
        ATTRIBUTION_NOTE,
      annotations: { readOnlyHint: true },
      inputSchema: {
        userId: z.string().describe('setlist.fm userId (username)'),
        p: page,
      },
    },
    async ({ userId, p }) => {
      const data = await client.request(
        'GET',
        `/1.0/user/${encodeURIComponent(userId)}/edited`,
        { query: { p } },
      );
      return textResult(data);
    },
  );
}
