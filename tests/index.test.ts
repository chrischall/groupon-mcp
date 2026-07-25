import { describe, it, expect, afterAll } from 'vitest';
import { registerArtistTools } from '../src/tools/artists.js';
import { registerSetlistTools } from '../src/tools/setlists.js';
import { registerVenueTools } from '../src/tools/venues.js';
import { registerGeoTools } from '../src/tools/geo.js';
import { registerUserTools } from '../src/tools/users.js';
import { registerResolveTools } from '../src/tools/resolve.js';
import { registerAttendanceTools } from '../src/tools/attendance.js';
import { registerUtilityTools } from '../src/tools/utilities.js';
import { client } from '../src/client.js';
import { createTestHarness } from './helpers.js';

// Verify the tool registry covers all expected tools. We register every tool on
// an McpServer and list them via a connected client.
describe('tool registry', () => {
  let harness: Awaited<ReturnType<typeof createTestHarness>>;

  afterAll(async () => {
    if (harness) await harness.close();
  });

  it('includes all 19 expected tools', async () => {
    harness = await createTestHarness((server) => {
      registerArtistTools(server, client);
      registerSetlistTools(server, client);
      registerVenueTools(server, client);
      registerGeoTools(server, client);
      registerUserTools(server, client);
      registerResolveTools(server, client);
      registerAttendanceTools(server, client);
      registerUtilityTools(server, client);
    });

    const tools = await harness.listTools();
    const allNames = tools.map((t) => t.name).sort();

    const expected = [
      'setlist_search_artists',
      'setlist_get_artist',
      'setlist_get_artist_setlists',
      'setlist_search_setlists',
      'setlist_get_setlist',
      'setlist_get_setlist_version',
      'setlist_search_venues',
      'setlist_get_venue',
      'setlist_get_venue_setlists',
      'setlist_search_cities',
      'setlist_get_city',
      'setlist_search_countries',
      'setlist_get_user',
      'setlist_get_user_attended',
      'setlist_get_user_edited',
      'setlist_resolve_concerts',
      'setlist_mark_attended',
      'setlist_unmark_attended',
      'setlist_healthcheck',
    ].sort();

    expect(allNames).toEqual(expected);
    expect(tools).toHaveLength(19);
  });
});
