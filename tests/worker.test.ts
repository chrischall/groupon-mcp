import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { GrouponClient } from '../src/client.js';
import { registerHealthcheckTools } from '../src/tools/healthcheck.js';
import { registerDealTools } from '../src/tools/deals.js';
import { registerDetailTools } from '../src/tools/detail.js';

// Handshake + tool-surface test for the Groupon Cloudflare remote connector,
// run inside the real Workers runtime (Miniflare) via
// `@cloudflare/vitest-pool-workers` against `wrangler.jsonc`. It proves four
// things that don't require any live Groupon session (Groupon reads are
// anonymous, so there is no credential to mint):
//   1. the OAuth default handler serves discovery + the login page, and
//   2. an unauthenticated `/mcp` request is rejected before any tool code runs;
//   3. GET /authorize renders the Groupon login page (no secret field — Groupon
//      reads are public);
//   4. the exact registrar wiring `src/worker.ts` uses registers ONLY the
//      READ-ONLY tool roster — and NO purchase / write tool.
//
// The full authenticated `initialize` + `tools/list` handshake over `/mcp`
// requires a real OAuth access token minted via `workers-oauth-provider`'s
// KV-backed grant flow, out of scope for a hermetic in-process test. So #4
// asserts tool registration through the same in-memory MCP harness the stdio
// suite uses, wired exactly as `worker.ts` wires it, rather than through the
// token-gated `/mcp` route.

const READ_ONLY_TOOLS = [
  'groupon_healthcheck',
  'groupon_search_deals',
  'groupon_get_deal',
  'groupon_list_categories',
];

// Write / cart tools that must NOT exist on the hosted read-only connector. The
// cart path (src/tools/cart.ts) is STDIO-only — src/worker.ts deliberately never
// registers it, keeping the cookie/fetchproxy auth tree out of the Worker
// bundle. This guards against any of them leaking into the Worker's tool surface.
const WRITE_TOOLS = [
  'groupon_purchase',
  'groupon_view_cart',
  'groupon_clear_cart',
  'groupon_buy',
  'groupon_checkout',
];

describe('Groupon Cloudflare connector — OAuth surface', () => {
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

  it('GET /authorize renders the Groupon login page', async () => {
    // No `client_id` query param: the login page renders without needing a
    // registered OAuth client, which is all we verify here.
    //
    // `redirect_uri` IS required though — don't drop it. workers-oauth-provider
    // 0.8.x calls validateRedirectUriScheme() unconditionally from
    // parseAuthRequest(), and that rejects any value without a scheme, including
    // the empty string an absent `redirect_uri` becomes ("Invalid redirect URI").
    const res = await SELF.fetch(
      'https://example.com/authorize?response_type=code&state=abc' +
        '&redirect_uri=' +
        encodeURIComponent('https://example.com/callback'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Groupon');
    // Groupon reads are public — the login page collects no secret, so there is
    // no password field on it.
    expect(html).not.toContain('type="password"');
  });
});

describe('Groupon Cloudflare connector — tool surface (read-only)', () => {
  it('registers ONLY the read tools via the same wiring as worker.ts', async () => {
    const client = new GrouponClient();

    // Mirror src/worker.ts's `tools` array exactly (same order, same wiring).
    const harness = await createTestHarness((server) => {
      registerHealthcheckTools(server);
      registerDealTools(server, client);
      registerDetailTools(server, client);
    });

    try {
      const names = (await harness.listTools()).map((t) => t.name).sort();
      expect(names).toEqual([...READ_ONLY_TOOLS].sort());
      // The confirm-gated cart/purchase path is STDIO-only — it must never
      // reach the hosted connector.
      expect(names).not.toContain('groupon_purchase');
      for (const write of WRITE_TOOLS) {
        expect(names).not.toContain(write);
      }
    } finally {
      await harness.close();
    }
  });
});
