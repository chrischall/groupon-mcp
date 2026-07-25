import { describe, it, expect, vi } from 'vitest';
import { GrouponClient } from '../src/client.js';
import { BROWSE_DEAL_FEED_HASH } from '../src/graphql-ops.js';

/** Build a Response-like object for the mocked fetch. */
function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** A minimal, well-formed batched BrowseDealFeed response. */
function feedRes(cards: unknown[] = [{ id: 'deal-1', title: 'Test deal' }]) {
  return jsonRes(200, [{ data: { browseDealFeed: { cards, facets: [], pagination: {}, browseProps: {}, __typename: 'BrowseDealFeed' } } }]);
}

function makeClient(fetchImpl: typeof fetch, opts: Partial<ConstructorParameters<typeof GrouponClient>[0]> = {}) {
  return new GrouponClient({
    fetchImpl,
    now: () => 1_000_000,
    sleep: async () => {},
    ...opts,
  });
}

describe('GrouponClient', () => {
  it('POSTs a batched array carrying the persisted hash and query filter', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(feedRes());
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await client.browseDealFeed({ query: 'massage', division: 'new-york', limit: 10, offset: 0 });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://www.groupon.com/mobilenextapi/graphql');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.headers['apollographql-client-name']).toBe('mobilenextapi');

    const batch = JSON.parse(init.body);
    expect(Array.isArray(batch)).toBe(true);
    expect(batch).toHaveLength(1);
    const op = batch[0];
    expect(op.operationName).toBe('BrowseDealFeed');
    expect(op.extensions.persistedQuery.sha256Hash).toBe(BROWSE_DEAL_FEED_HASH);
    expect(op.variables.dealFeedParams.division).toBe('new-york');
    expect(op.variables.dealFeedParams.filters).toEqual([
      { key: 'query', subKey: null, value: { static: 'massage' } },
    ]);
  });

  it('omits the query filter for a plain browse (no query)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(feedRes());
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await client.browseDealFeed({ division: 'chicago', limit: 5, offset: 0 });

    const batch = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(batch[0].variables.dealFeedParams.filters).toEqual([]);
  });

  it('parses browseDealFeed out of element[0].data', async () => {
    const cards = [{ id: 'a' }, { id: 'b' }];
    const fetchImpl = vi.fn().mockResolvedValue(feedRes(cards));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const feed = await client.browseDealFeed({ division: 'syracuse', limit: 2, offset: 0 });
    expect(feed.cards).toEqual(cards);
  });

  it('maps PersistedQueryNotFound to an actionable McpToolError', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonRes(200, [{ errors: [{ message: 'PersistedQueryNotFound' }] }]));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.browseDealFeed({ division: 'new-york', limit: 10, offset: 0 })).rejects.toThrow(
      /re-captured|persisted query is stale/i,
    );
  });

  it('rejects a non-JSON 2xx (bot/challenge interstitial) rather than parsing blind', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('<!doctype html><html>Access denied</html>', { status: 200 }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.browseDealFeed({ division: 'new-york', limit: 10, offset: 0 })).rejects.toThrow(
      /non-JSON|interstitial/i,
    );
  });

  it('surfaces the body on non-2xx HTTP errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('Bad Request', { status: 400 }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.browseDealFeed({ division: 'new-york', limit: 10, offset: 0 })).rejects.toThrow(
      /Groupon GraphQL/i,
    );
  });

  it('retries once on 429, honoring Retry-After', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(429, {}, { 'Retry-After': '3' }))
      .mockResolvedValueOnce(feedRes());
    const client = makeClient(fetchImpl as unknown as typeof fetch, { sleep });
    const feed = await client.browseDealFeed({ division: 'new-york', limit: 10, offset: 0 });
    expect(feed.cards).toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('surfaces a rate limit still failing after the retry', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => jsonRes(503, {}, { 'Retry-After': '9999' }));
    const client = makeClient(fetchImpl as unknown as typeof fetch, { sleep });
    await expect(client.browseDealFeed({ division: 'new-york', limit: 10, offset: 0 })).rejects.toThrow(
      /rate limit/i,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0][0]).toBeLessThanOrEqual(30_000);
  });

  it('caches identical requests within the TTL', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => feedRes());
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await client.browseDealFeed({ query: 'spa', division: 'new-york', limit: 10, offset: 0 });
    await client.browseDealFeed({ query: 'spa', division: 'new-york', limit: 10, offset: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keys the cache by op args (different offset misses)', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => feedRes());
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await client.browseDealFeed({ query: 'spa', division: 'new-york', limit: 10, offset: 0 });
    await client.browseDealFeed({ query: 'spa', division: 'new-york', limit: 10, offset: 10 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not cache when TTL is 0', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => feedRes());
    const client = makeClient(fetchImpl as unknown as typeof fetch, { cacheTtlMs: 0 });
    await client.browseDealFeed({ division: 'new-york', limit: 10, offset: 0 });
    await client.browseDealFeed({ division: 'new-york', limit: 10, offset: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
