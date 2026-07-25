import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textResult, isoToDmy, isoToCompactTimestamp } from '@chrischall/mcp-utils';
import type { SetlistClient } from '../client.js';
import { ATTRIBUTION_NOTE } from '../attribution.js';

// How to read a setlist's song data (per setlist.fm's guidelines), so the model
// renders shows correctly. Appended to the get_setlist descriptions.
const SETLIST_SHAPE_NOTE =
  ' A setlist\'s songs live in `sets.set[]`; each set may have an `encore` number (1 = first encore) and a `name` (e.g. an acoustic set or a full album). Each `song` may carry: `tape: true` (pre-recorded intro/outro/interlude — not actually performed), `cover` (the original artist when it is a cover), `with` (a guest performer), and `info` (a note like "acoustic" or "first time live").';

const page = z
  .number()
  .int()
  .positive()
  .optional()
  .describe('Result page number (defaults to 1)');

export function registerSetlistTools(server: McpServer, client: SetlistClient): void {
  server.registerTool(
    'setlist_search_setlists',
    {
      description:
        "Search setlist.fm for concert setlists. Filter by any combination of artist, venue, city, country, tour, date, or year (provide at least one). Combine filters to disambiguate — artistName + date can span multiple cities, so add cityName/cityId or venueName/venueId to pin the exact show. Omit the artist and pass venueName/venueId + date to list EVERY performer at a venue or festival that day. Every result includes songCount, setCount, and hasSongs, so you can skip empty 'stub' setlists (hasSongs: false) without a second fetch." +
        ATTRIBUTION_NOTE,
      annotations: { readOnlyHint: true },
      inputSchema: {
        artistName: z.string().optional().describe('Artist name'),
        artistMbid: z.string().optional().describe("Artist's MusicBrainz ID (mbid)"),
        venueName: z.string().optional().describe('Venue name'),
        venueId: z.string().optional().describe('Venue ID'),
        cityName: z.string().optional().describe('City name'),
        cityId: z.string().optional().describe("City's geoId"),
        state: z.string().optional().describe('State name'),
        stateCode: z.string().optional().describe('State code'),
        countryCode: z.string().optional().describe('Country code (ISO 3166-1 alpha-2)'),
        tourName: z.string().optional().describe('Tour name'),
        date: z
          .string()
          .optional()
          .describe('Event date, ISO yyyy-MM-dd (e.g. 2025-08-28)'),
        year: z.number().int().optional().describe('Event year'),
        lastUpdated: z
          .string()
          .optional()
          .describe('Only setlists updated on/after this UTC time, ISO yyyy-MM-dd or yyyy-MM-ddTHH:mm:ss'),
        p: page,
      },
    },
    async (args) => {
      const query = { ...args } as Record<string, string | number | undefined>;
      if (args.date) query.date = isoToDmy(args.date);
      if (args.lastUpdated) query.lastUpdated = isoToCompactTimestamp(args.lastUpdated);
      const data = await client.request('GET', '/1.0/search/setlists', { query });
      return textResult(data);
    },
  );

  server.registerTool(
    'setlist_get_setlist',
    {
      description:
        "Get a setlist.fm setlist by its ID, including the full song list and event details." +
        SETLIST_SHAPE_NOTE +
        ATTRIBUTION_NOTE,
      annotations: { readOnlyHint: true },
      inputSchema: {
        setlistId: z.string().describe('Setlist ID (e.g. 63de4613)'),
      },
    },
    async ({ setlistId }) => {
      const data = await client.request('GET', `/1.0/setlist/${encodeURIComponent(setlistId)}`);
      return textResult(data);
    },
  );

  server.registerTool(
    'setlist_get_setlist_version',
    {
      description:
        "Get a specific historical version of a setlist by its version ID. Setlists are wiki-edited; each edit has a version ID returned in a setlist's `versionId` field." +
        SETLIST_SHAPE_NOTE +
        ATTRIBUTION_NOTE,
      annotations: { readOnlyHint: true },
      inputSchema: {
        versionId: z.string().describe('Setlist version ID'),
      },
    },
    async ({ versionId }) => {
      const data = await client.request(
        'GET',
        `/1.0/setlist/version/${encodeURIComponent(versionId)}`,
      );
      return textResult(data);
    },
  );
}
