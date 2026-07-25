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

export function registerArtistTools(server: McpServer, client: SetlistClient): void {
  server.registerTool(
    'setlist_search_artists',
    {
      description:
        "Search setlist.fm for artists by name or MusicBrainz ID. Returns matching artists with their MusicBrainz ID (mbid) — use that mbid with setlist_get_artist or setlist_get_artist_setlists." +
        ATTRIBUTION_NOTE,
      annotations: { readOnlyHint: true },
      inputSchema: {
        artistName: z.string().optional().describe('Artist name to search for'),
        artistMbid: z.string().optional().describe("Artist's MusicBrainz ID (mbid)"),
        sort: z
          .enum(['sortName', 'relevance'])
          .optional()
          .describe('Sort order (sortName = default, or relevance)'),
        p: page,
      },
    },
    async ({ artistName, artistMbid, sort, p }) => {
      const data = await client.request('GET', '/1.0/search/artists', {
        query: { artistName, artistMbid, sort, p },
      });
      return textResult(data);
    },
  );

  server.registerTool(
    'setlist_get_artist',
    {
      description: "Get a setlist.fm artist by their MusicBrainz ID (mbid)." + ATTRIBUTION_NOTE,
      annotations: { readOnlyHint: true },
      inputSchema: {
        mbid: z.string().describe("Artist's MusicBrainz ID (mbid)"),
      },
    },
    async ({ mbid }) => {
      const data = await client.request('GET', `/1.0/artist/${encodeURIComponent(mbid)}`);
      return textResult(data);
    },
  );

  server.registerTool(
    'setlist_get_artist_setlists',
    {
      description:
        "Get an artist's setlists (most recent first) by their MusicBrainz ID (mbid). Paginated via `p`." +
        ATTRIBUTION_NOTE,
      annotations: { readOnlyHint: true },
      inputSchema: {
        mbid: z.string().describe("Artist's MusicBrainz ID (mbid)"),
        p: page,
      },
    },
    async ({ mbid, p }) => {
      const data = await client.request(
        'GET',
        `/1.0/artist/${encodeURIComponent(mbid)}/setlists`,
        { query: { p } },
      );
      return textResult(data);
    },
  );
}
