import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { SetlistClient } from '../src/client.js';
import { registerArtistTools } from '../src/tools/artists.js';
import { registerSetlistTools } from '../src/tools/setlists.js';
import { registerVenueTools } from '../src/tools/venues.js';
import { registerGeoTools } from '../src/tools/geo.js';
import { registerUserTools } from '../src/tools/users.js';
import { registerResolveTools } from '../src/tools/resolve.js';
import { registerUrlTools } from '../src/tools/urls.js';
import { registerUtilityTools } from '../src/tools/utilities.js';

// Handshake + tool-surface test for the setlist.fm Cloudflare remote connector,
// run inside the real Workers runtime (Miniflare) via
// `@cloudflare/vitest-pool-workers` against `wrangler.jsonc`. It proves three
// things that don't require a live setlist.fm session:
//   1. the OAuth default handler serves discovery + the login page, and
//   2. an unauthenticated `/mcp` request is rejected before any tool code runs;
//   3. the exact registrar wiring `src/worker.ts` uses registers ONLY the
//      READ-ONLY tool surface — the two attendance-WRITE tools are absent.
//
// The full authenticated `initialize` + `tools/list` handshake over `/mcp`
// requires a real OAuth access token minted via `workers-oauth-provider`'s
// KV-backed grant flow, out of scope for a hermetic in-process test. So #3
// asserts tool registration through the same in-memory MCP harness the stdio
// suite uses, wired exactly as `worker.ts` wires it, rather than through the
// token-gated `/mcp` route.

const READ_ONLY_TOOLS = [
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
  'setlist_id_from_url',
  'setlist_healthcheck',
];

// The cookie-session attendance WRITE tools that must NOT be registered on the
// hosted read-only connector.
const ATTENDANCE_WRITE_TOOLS = ['setlist_mark_attended', 'setlist_unmark_attended'];

describe('setlist.fm Cloudflare connector — OAuth surface', () => {
  it('serves the OAuth authorization-server discovery document', async () => {
    const res = await SELF.fetch('https://example.com/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    const meta = (await res.json()) as { authorization_endpoint?: string; token_endpoint?: string };
    expect(meta.authorization_endpoint).toContain('/authorize');
    expect(meta.token_endpoint).toContain('/token');
  });

  it('rejects an unauthenticated /mcp request', async () => {
    const res = await SELF.fetch('https://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('GET /authorize renders the setlist.fm login page with the API-key field', async () => {
    // No `client_id` query param: the login page renders without needing a
    // registered OAuth client, which is all we verify here.
    //
    // `redirect_uri` IS required though — don't drop it. workers-oauth-provider
    // 0.8.x calls validateRedirectUriScheme() unconditionally from
    // parseAuthRequest(), and that rejects any value without a scheme, including
    // the empty string an absent `redirect_uri` becomes ("Invalid redirect URI").
    // 0.0.x only screened for dangerous schemes, so omitting it used to work.
    const res = await SELF.fetch(
      'https://example.com/authorize?response_type=code&state=abc' +
        '&redirect_uri=' +
        encodeURIComponent('https://example.com/callback'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('setlist.fm');
    expect(html).toContain('setlist.fm API key');
    expect(html).toContain('type="password"');
  });
});

describe('setlist.fm Cloudflare connector — tool surface (read-only)', () => {
  it('registers ONLY the read tools via the same wiring as worker.ts', async () => {
    const client = new SetlistClient({ apiKey: 'test-key' });

    // Mirror src/worker.ts's `tools` array exactly (same order, same wiring) —
    // notably WITHOUT registerAttendanceTools.
    const harness = await createTestHarness((server) => {
      registerArtistTools(server, client);
      registerSetlistTools(server, client);
      registerVenueTools(server, client);
      registerGeoTools(server, client);
      registerUserTools(server, client);
      registerResolveTools(server, client);
      registerUrlTools(server);
      registerUtilityTools(server, client);
    });

    try {
      const names = (await harness.listTools()).map((t) => t.name).sort();
      expect(names).toEqual([...READ_ONLY_TOOLS].sort());
      // The attendance-write tools must be absent.
      for (const write of ATTENDANCE_WRITE_TOOLS) {
        expect(names).not.toContain(write);
      }
    } finally {
      await harness.close();
    }
  });
});
