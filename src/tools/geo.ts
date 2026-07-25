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

export function registerGeoTools(server: McpServer, client: SetlistClient): void {
  server.registerTool(
    'setlist_search_cities',
    {
      description:
        "Search setlist.fm for cities by name and/or location. Returns cities with their geoId — use it as cityId in setlist_search_setlists / setlist_search_venues, or with setlist_get_city." +
        ATTRIBUTION_NOTE,
      annotations: { readOnlyHint: true },
      inputSchema: {
        name: z.string().optional().describe('City name'),
        country: z.string().optional().describe("City's country"),
        state: z.string().optional().describe('State the city lies in'),
        stateCode: z.string().optional().describe('State code the city lies in'),
        p: page,
      },
    },
    async (args) => {
      const data = await client.request('GET', '/1.0/search/cities', { query: args });
      return textResult(data);
    },
  );

  server.registerTool(
    'setlist_get_city',
    {
      description: "Get a city by its geoId." + ATTRIBUTION_NOTE,
      annotations: { readOnlyHint: true },
      inputSchema: {
        geoId: z.string().describe("City's geoId"),
      },
    },
    async ({ geoId }) => {
      const data = await client.request('GET', `/1.0/city/${encodeURIComponent(geoId)}`);
      return textResult(data);
    },
  );

  server.registerTool(
    'setlist_search_countries',
    {
      description:
        "List all countries supported by setlist.fm, with their ISO country codes. Use a code as countryCode in setlist_search_setlists." +
        ATTRIBUTION_NOTE,
      annotations: { readOnlyHint: true },
    },
    async () => {
      const data = await client.request('GET', '/1.0/search/countries');
      return textResult(data);
    },
  );
}
