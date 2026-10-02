import { describe, it, expect, vi } from 'vitest';
import { EdgeBlockedError } from '@chrischall/mcp-utils';
import { GrouponClient } from '../src/client.js';
import { GrouponWebClient, SessionExpiredError } from '../src/web-client.js';
import { AKAMAI_403, CLOUDFLARE_403, ORIGIN_403, htmlRes } from './fixtures/edge-pages.js';

// chrischall/mcp-host#1015: a CDN/WAF refusal page is reported as a block
// (EdgeBlockedError), never as a dead session or a stale persisted hash, and it
// never spends the stored session cookie on a re-lift.

function cartRes() {
  return new Response(JSON.stringify([{ data: { getCart: { items: [] } } }]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function liftClient(fetchImpl: typeof fetch, lift: () => Promise<{ cookieHeader: string }>) {
  return new GrouponWebClient({ fetchImpl, sleep: async () => {}, resolveCookie: lift });
}

describe('edge blocks on the anonymous read client', () => {
  it.each([
    ['Akamai', AKAMAI_403],
    ['Cloudflare', CLOUDFLARE_403],
  ])('surfaces a %s 403 page as EdgeBlockedError, not the persisted-hash hint', async (vendor, page) => {
    const fetchImpl = vi.fn(async () => htmlRes(403, page));
    const client = new GrouponClient({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
    const err = await client.getMainNavigation().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EdgeBlockedError);
    expect((err as EdgeBlockedError).vendor).toBe(vendor);
    expect((err as EdgeBlockedError).status).toBe(403);
    expect(String((err as Error).message)).not.toMatch(/persisted/i);
  });

  it('control: a plain origin 403 is still a generic HTTP error, not a block', async () => {
    const fetchImpl = vi.fn(async () => htmlRes(403, ORIGIN_403));
    const client = new GrouponClient({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
    const err = await client.getMainNavigation().catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(EdgeBlockedError);
    expect(String((err as Error).message)).toMatch(/403/);
  });
});

describe('edge blocks on the cart client', () => {
  it.each([
    ['Akamai', AKAMAI_403, 403],
    ['Cloudflare', CLOUDFLARE_403, 403],
    ['Akamai (401)', AKAMAI_403, 401],
  ])('a %s page throws EdgeBlockedError and does NOT re-lift or drop the cookie', async (_label, page, status) => {
    const lift = vi.fn(async () => ({ cookieHeader: 'session=live' }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlRes(status, page))
      .mockResolvedValueOnce(cartRes());
    const client = liftClient(fetchImpl as unknown as typeof fetch, lift);

    const err = await client.getCart().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EdgeBlockedError);
    expect(err).not.toBeInstanceOf(SessionExpiredError);
    // One request, one lift: the block did not burn a bridge re-lift.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(lift).toHaveBeenCalledTimes(1);

    // The cookie is still cached: the next call reuses it without a re-lift.
    await client.getCart();
    expect(lift).toHaveBeenCalledTimes(1);
    expect(((fetchImpl.mock.calls[1]![1] as RequestInit).headers as Record<string, string>).Cookie).toBe('session=live');
  });

  it('a block on a mutation is EdgeBlockedError too (and is not replayed)', async () => {
    const fetchImpl = vi.fn(async () => htmlRes(403, AKAMAI_403));
    const client = new GrouponWebClient({ fetchImpl: fetchImpl as unknown as typeof fetch, cookie: 'session=x', sleep: async () => {} });
    await expect(client.deleteCartItem({ optionId: 'opt-1' })).rejects.toBeInstanceOf(EdgeBlockedError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('control: a genuine 403 still re-lifts once, then reports an expired session', async () => {
    const lift = vi.fn(async () => ({ cookieHeader: 'session=dead' }));
    const fetchImpl = vi.fn(async () => htmlRes(403, ORIGIN_403));
    const client = liftClient(fetchImpl as unknown as typeof fetch, lift);
    await expect(client.getCart()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(lift).toHaveBeenCalledTimes(2);
  });
});
