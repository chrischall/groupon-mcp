import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textResult, toolAnnotations } from '@chrischall/mcp-utils';

/**
 * Extract the setlist ID from a setlist.fm setlist URL. The ID is the trailing
 * hex token (length varies — 7 and 8 chars observed) right before an optional
 * `.html`, e.g. `.../setlist/elle-king/2024/the-fillmore-charlotte-nc-4ba8a766.html`.
 *
 * Scoped to the singular `/setlist/` path so lookalike hex tokens on other page
 * types (artist `/setlists/...`, venue `/venue/...`) are NOT matched. Query
 * string, fragment, and a trailing slash are stripped before matching; `http`
 * or `https`, with or without `www.`, and a missing `.html` are all tolerated.
 *
 * @throws if no setlist ID can be parsed.
 */
export function extractSetlistId(url: string): string {
  const clean = url.trim().split('#')[0].split('?')[0].replace(/\/+$/, '');
  const match = clean.match(/\/setlist\/.*-([0-9a-f]+)(?:\.html)?$/);
  if (!match) {
    throw new Error(
      `Could not parse a setlist ID from URL: ${url}. Expected a setlist.fm /setlist/ link ending in a hex id (e.g. https://www.setlist.fm/setlist/.../...-4ba8a766.html).`,
    );
  }
  return match[1];
}

export function registerUrlTools(server: McpServer): void {
  server.registerTool(
    'setlist_id_from_url',
    {
      title: 'Extract a setlist ID from a setlist.fm URL',
      description:
        'Parse the setlist ID out of a setlist.fm setlist URL so you can paste a link instead of hunting for the ID. Returns {setlistId} (the trailing hex token before .html), ready to feed into setlist_get_setlist / setlist_mark_attended. Scoped to /setlist/ pages — artist (/setlists/) and venue (/venue/) URLs are rejected. Tolerates http/https, with/without www, trailing slash, query/fragment, and a missing .html. Pure local parsing — no network call. Errors if no ID can be parsed.',
      annotations: toolAnnotations({
        title: 'Extract a setlist ID from a setlist.fm URL',
        readOnly: true,
        idempotent: true,
        openWorld: false,
      }),
      inputSchema: {
        url: z.string().describe('A setlist.fm setlist URL, e.g. https://www.setlist.fm/setlist/.../...-4ba8a766.html'),
      },
    },
    async ({ url }) => textResult({ setlistId: extractSetlistId(url) }),
  );
}
