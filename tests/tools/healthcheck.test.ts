import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerHealthcheckTools } from '../../src/tools/healthcheck.js';
import { GrouponClient } from '../../src/client.js';
import { AKAMAI_403, CLOUDFLARE_403, ORIGIN_403, htmlRes } from '../fixtures/edge-pages.js';

interface Health {
  ok: boolean;
  credential: { source: string | null; resolved: boolean; detail?: Record<string, unknown> };
  probe: { url?: string; elapsed_ms: number };
  error?: { kind: string; message: string; detail?: Record<string, unknown> };
  hint: string;
}

function navRes() {
  return new Response(JSON.stringify([{ data: { mainNavigation: { items: [] } } }]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function run(fetchImpl: (...a: unknown[]) => Promise<Response>) {
  const client = new GrouponClient({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
  const h = await createTestHarness((s) => registerHealthcheckTools(s, client));
  const res = await h.callTool('groupon_healthcheck', {});
  await h.close();
  return parseToolResult<Health>(res);
}

afterEach(() => {
  delete process.env.GROUPON_SESSION_COOKIE;
});

describe('groupon_healthcheck', () => {
  it('probes the live GraphQL endpoint and reports ok with no credential needed', async () => {
    const fetchImpl = vi.fn(async () => navRes());
    const data = await run(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(data.ok).toBe(true);
    expect(data.error).toBeUndefined();
    expect(data.credential.source).toBe('anonymous');
    expect(data.probe.url).toBe('https://www.groupon.com/mobilenextapi/graphql');
    expect(data.hint).toMatch(/deal reads/i);
  });

  it('never answers from the response cache — each call is a real round-trip', async () => {
    const fetchImpl = vi.fn(async () => navRes());
    const client = new GrouponClient({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
    await client.getMainNavigation(); // warm the cache a real tool would use
    const h = await createTestHarness((s) => registerHealthcheckTools(s, client));
    await h.callTool('groupon_healthcheck', {});
    await h.callTool('groupon_healthcheck', {});
    await h.close();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('names the cart session source without echoing the cookie', async () => {
    process.env.GROUPON_SESSION_COOKIE = 'session=supersecret';
    const data = await run(vi.fn(async () => navRes()));
    expect(data.credential.detail?.cart_session).toBe('GROUPON_SESSION_COOKIE');
    expect(JSON.stringify(data)).not.toContain('supersecret');
  });

  it.each([
    ['Akamai', AKAMAI_403],
    ['Cloudflare', CLOUDFLARE_403],
  ])('reports a %s block page as edge_blocked', async (vendor, page) => {
    const data = await run(vi.fn(async () => htmlRes(403, page)));
    expect(data.ok).toBe(false);
    expect(data.error?.kind).toBe('edge_blocked');
    expect(data.error?.detail).toEqual({ vendor });
    expect(data.hint).toMatch(/CDN\/WAF/);
  });

  it('control: a plain origin 403 is an http failure, not a rejected credential or a block', async () => {
    const data = await run(vi.fn(async () => htmlRes(403, ORIGIN_403)));
    expect(data.ok).toBe(false);
    expect(data.error?.kind).toBe('http');
    expect(data.hint).not.toMatch(/CDN\/WAF/);
    expect(data.hint).toMatch(/no credential/i);
  });

  it('control: a plain 401 is http too — the reads send no credential to reject', async () => {
    const data = await run(
      vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })),
    );
    expect(data.error?.kind).toBe('http');
  });

  it('reports a 401 block page as edge_blocked, not a rejected credential', async () => {
    const data = await run(vi.fn(async () => htmlRes(401, AKAMAI_403)));
    expect(data.error?.kind).toBe('edge_blocked');
  });

  it('reports an upstream 500 as http', async () => {
    const data = await run(vi.fn(async () => htmlRes(500, 'Internal Server Error')));
    expect(data.error?.kind).toBe('http');
  });

  it('reports a network failure as transport', async () => {
    const data = await run(vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    expect(data.error?.kind).toBe('transport');
  });

  it('reports a stale persisted-query hash with its re-capture message', async () => {
    const stale = vi.fn(async () =>
      new Response(JSON.stringify([{ errors: [{ message: 'PersistedQueryNotFound' }] }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const data = await run(stale);
    expect(data.ok).toBe(false);
    expect(data.error?.kind).toBe('stale_persisted_query');
    expect(data.error?.message).toMatch(/re-captured/);
  });
});
