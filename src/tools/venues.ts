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

export function registerVenueTools(server: McpServer, client: SetlistClient): void {
  server.registerTool(
    'setlist_search_venues',
    {
      description:
        "Search setlist.fm for venues by name and/or location. Returns matching venues with their venue ID — use it with setlist_get_venue or setlist_get_venue_setlists." +
        ATTRIBUTION_NOTE,
      annotations: { readOnlyHint: true },
      inputSchema: {
        name: z.string().optional().describe('Venue name'),
        cityName: z.string().optional().describe('City the venue is in'),
        cityId: z.string().optional().describe("City's geoId"),
        state: z.string().optional().describe('State name'),
        stateCode: z.string().optional().describe('State code'),
        country: z.string().optional().describe("Venue's country"),
        p: page,
      },
    },
    async (args) => {
      const data = await client.request('GET', '/1.0/search/venues', { query: args });
      return textResult(data);
    },
  );

  server.registerTool(
    'setlist_get_venue',
    {
      description: "Get a setlist.fm venue by its ID." + ATTRIBUTION_NOTE,
      annotations: { readOnlyHint: true },
      inputSchema: {
        venueId: z.string().describe('Venue ID'),
      },
    },
    async ({ venueId }) => {
      const data = await client.request('GET', `/1.0/venue/${encodeURIComponent(venueId)}`);
      return textResult(data);
    },
  );

  server.registerTool(
    'setlist_get_venue_setlists',
    {
      description:
        "Get setlists performed at a venue, by venue ID (most recent first). Paginated via `p`." +
        ATTRIBUTION_NOTE,
      annotations: { readOnlyHint: true },
      inputSchema: {
        venueId: z.string().describe('Venue ID'),
        p: page,
      },
    },
    async ({ venueId, p }) => {
      const data = await client.request(
        'GET',
        `/1.0/venue/${encodeURIComponent(venueId)}/setlists`,
        { query: { p } },
      );
      return textResult(data);
    },
  );
}
