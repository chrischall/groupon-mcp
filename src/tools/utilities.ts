import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textResult, toolAnnotations, messageOf } from '@chrischall/mcp-utils';
import type { SetlistClient } from '../client.js';

interface CountriesResponse {
  total?: number;
  country?: unknown[];
}

export function registerUtilityTools(server: McpServer, client: SetlistClient): void {
  server.registerTool(
    'setlist_healthcheck',
    {
      title: 'Verify setlist.fm API key + connectivity',
      description:
        'Confirm the API key is configured and works by calling the setlist.fm countries endpoint. Reports {ok, authenticated, country_count} with a plain-English hint distinguishing "no key" vs "bad key" vs "API error". Read-only.',
      annotations: toolAnnotations({
        title: 'Verify setlist.fm API key + connectivity',
        readOnly: true,
        idempotent: true,
        openWorld: true,
      }),
      inputSchema: {},
    },
    async () => {
      try {
        const data = await client.request<CountriesResponse>('GET', '/1.0/search/countries');
        const count = data.total ?? data.country?.length ?? 0;
        return textResult({
          ok: true,
          authenticated: true,
          country_count: count,
          hint: 'API key is valid and the setlist.fm API is reachable.',
        });
      } catch (e) {
        const msg = messageOf(e);
        const noKey = /environment variable is required/.test(msg);
        const badKey = /\b(401|403)\b/.test(msg);
        return textResult({
          ok: false,
          authenticated: false,
          error: msg,
          hint: noKey
            ? 'Set SETLIST_API_KEY (in .env or the MCP host env), then retry. Apply for a key at https://www.setlist.fm/settings/api.'
            : badKey
              ? 'The API key was rejected (401/403). Verify SETLIST_API_KEY is correct and active.'
              : 'The setlist.fm API call failed — it may be rate-limited or temporarily unavailable. Retry shortly.',
        });
      }
    },
  );
}
