import { describe, it, expect, afterAll } from 'vitest';
import { registerArtistTools } from '../../src/tools/artists.js';
import { registerSetlistTools } from '../../src/tools/setlists.js';
import { registerVenueTools } from '../../src/tools/venues.js';
import { registerGeoTools } from '../../src/tools/geo.js';
import { registerUserTools } from '../../src/tools/users.js';
import { registerResolveTools } from '../../src/tools/resolve.js';
import { registerAttendanceTools } from '../../src/tools/attendance.js';
import { registerUrlTools } from '../../src/tools/urls.js';
import { registerUtilityTools } from '../../src/tools/utilities.js';
import { ATTRIBUTION_NOTE } from '../../src/attribution.js';
import { client } from '../../src/client.js';
import { createTestHarness } from '../helpers.js';

// setlist.fm's API terms require followable attribution wherever their data is
// shown. Every tool that returns setlist.fm data must instruct the model to
// surface the source link; tools that surface no setlist.fm data must not carry
// the note: setlist_healthcheck (connectivity probe) and setlist_id_from_url
// (pure local URL parsing, no API call).
const MARKER = 'followable attribution';
const NO_DATA_TOOLS = new Set(['setlist_healthcheck', 'setlist_id_from_url']);

describe('attribution coverage', () => {
  let harness: Awaited<ReturnType<typeof createTestHarness>>;
  afterAll(async () => {
    if (harness) await harness.close();
  });

  it('every data tool carries the attribution note; healthcheck does not', async () => {
    expect(ATTRIBUTION_NOTE).toContain(MARKER); // guards the marker if the note is reworded

    harness = await createTestHarness((server) => {
      registerArtistTools(server, client);
      registerSetlistTools(server, client);
      registerVenueTools(server, client);
      registerGeoTools(server, client);
      registerUserTools(server, client);
      registerResolveTools(server, client);
      registerAttendanceTools(server, client);
      registerUrlTools(server);
      registerUtilityTools(server, client);
    });

    // harness.listTools() returns names only; read full descriptions via the
    // raw MCP client.
    const { tools } = await harness.client.listTools();
    for (const tool of tools) {
      const hasNote = (tool.description ?? '').includes(MARKER);
      if (NO_DATA_TOOLS.has(tool.name)) {
        expect(hasNote, `${tool.name} surfaces no data and should not carry the attribution note`).toBe(false);
      } else {
        expect(hasNote, `${tool.name} is missing the attribution note`).toBe(true);
      }
    }
  });
});
