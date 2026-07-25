import { createConnector } from '@chrischall/mcp-connector';
import { GrouponClient } from './client.js';
import { grouponAuth, type GrouponProps } from './groupon-auth.js';
import { VERSION } from './version.js';
import { registerHealthcheckTools } from './tools/healthcheck.js';
import { registerDealTools } from './tools/deals.js';
import { registerDetailTools } from './tools/detail.js';

// The Cloudflare remote-connector entrypoint: wires Groupon's READ-ONLY tool
// registrars into `@chrischall/mcp-connector`'s generic OAuth + McpAgent
// harness, exposing the same read surface the stdio server (`src/index.ts`)
// serves — deal search/browse, deal detail, category taxonomy, healthcheck —
// to claude.ai over `/mcp`.
//
// ANONYMOUS reads: Groupon's consumer GraphQL endpoint needs no credential, so
// `buildClient` constructs a plain credential-free `GrouponClient` (it ignores
// the empty `GrouponProps`) and the login page (`src/groupon-auth.ts`) collects
// no secret — it only proves reachability.
//
// The service is STATELESS — no cache Durable Object, no per-user storage beyond
// the connector's own per-session `MCP_OBJECT` agent.
//
// This module deliberately imports ONLY the read tool modules + `GrouponClient`
// from `./client.js`. It does NOT import `./index.ts` (whose top-level
// `runMcp(...)` would try to start a stdio server inside the Worker). Any future
// purchase / cookie WRITE module must likewise stay out of this import graph so
// it never reaches the Worker bundle.
const { Agent, handler } = createConnector<GrouponProps, GrouponClient>({
  name: 'groupon-mcp',
  version: VERSION,
  auth: grouponAuth,
  // Reads are unauthenticated: a fresh, credential-free client per session.
  buildClient: () => new GrouponClient(),
  tools: [
    registerHealthcheckTools,
    (server, client) => registerDealTools(server, client),
    (server, client) => registerDetailTools(server, client),
  ],
});

// The connector's per-session MCP agent Durable Object
// (`wrangler.jsonc`'s `MCP_OBJECT` → `GrouponMcpAgent`) resolves this named export.
export { Agent as GrouponMcpAgent };

export default handler;
