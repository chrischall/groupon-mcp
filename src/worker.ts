import { createConnector } from '@chrischall/mcp-connector';
import { SetlistClient } from './client.js';
import { setlistAuth, type SetlistProps } from './setlist-auth.js';
import { VERSION } from './version.js';
import { registerArtistTools } from './tools/artists.js';
import { registerSetlistTools } from './tools/setlists.js';
import { registerVenueTools } from './tools/venues.js';
import { registerGeoTools } from './tools/geo.js';
import { registerUserTools } from './tools/users.js';
import { registerResolveTools } from './tools/resolve.js';
import { registerUrlTools } from './tools/urls.js';
import { registerUtilityTools } from './tools/utilities.js';

// The Cloudflare remote-connector entrypoint: wires setlist.fm's READ-ONLY tool
// registrars into `@chrischall/mcp-connector`'s generic OAuth + McpAgent
// harness, with a per-user `SetlistClient` built from each user's own
// `x-api-key` (collected + verified by `src/setlist-auth.ts`).
//
// The service is STATELESS — no cache, no Durable Object storage beyond the
// connector's own per-session `MCP_OBJECT` agent — so there is none of the
// cache plumbing the OFW connector needs.
//
// READ-ONLY v1: the two attendance-WRITE tools (`setlist_mark_attended` /
// `setlist_unmark_attended`, in `registerAttendanceTools`) are deliberately
// OMITTED. They authenticate via a cookie session (`web-client.ts` /
// `fetchproxy-cookie.ts` / `@fetchproxy/*`) that has no hosted refresh path, so
// that whole module tree must stay out of the Worker bundle. Only the api-key
// read registrars are wired in below — keeping the exact same order the stdio
// server (`src/index.ts`) uses, minus attendance.
const { Agent, handler } = createConnector<SetlistProps, SetlistClient>({
  name: 'setlist-mcp',
  version: VERSION,
  auth: setlistAuth,
  buildClient: (props) => new SetlistClient({ apiKey: props.apiKey }),
  tools: [
    registerArtistTools,
    registerSetlistTools,
    registerVenueTools,
    registerGeoTools,
    registerUserTools,
    registerResolveTools,
    registerUrlTools,
    registerUtilityTools,
  ],
});

// The connector's per-session MCP agent Durable Object
// (`wrangler.jsonc`'s `MCP_OBJECT` → `SetlistMcpAgent`) resolves this named export.
export { Agent as SetlistMcpAgent };

export default handler;
