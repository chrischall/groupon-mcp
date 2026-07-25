import { describe, it, expect, vi, afterEach } from 'vitest';
import { GrouponWebClient, SessionExpiredError } from '../src/web-client.js';
import {
  GET_CART_HASH,
  CREATE_OR_UPDATE_CART_ITEM_HASH,
  DELETE_CART_ITEM_HASH,
} from '../src/graphql-ops.js';

/** Build a JSON Response for the mocked fetch. */
function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** A minimal, well-formed batched GetCart response (a present, empty cart). */
function cartRes(getCart: unknown = { items: [], __typename: 'Cart' }) {
  return jsonRes(200, [{ data: { getCart } }]);
}

/** Construct a client with an injected cookie so the bridge is never touched. */
function makeClient(fetchImpl: typeof fetch, cookie = 'session=abc') {
  return new GrouponWebClient({ fetchImpl, cookie, sleep: async () => {} });
}

describe('GrouponWebClient', () => {
  afterEach(() => {
    delete process.env.GROUPON_SESSION_COOKIE;
  });

  it('getCart POSTs a single-op batch with the GetCart hash + cookie + minimal headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(cartRes());
    const client = makeClient(fetchImpl as unknown as typeof fetch, 'gsession=xyz');
    const cart = await client.getCart();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://www.groupon.com/mobilenextapi/graphql');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.headers['apollographql-client-name']).toBe('mobilenextapi');
    expect(init.headers['x-operation-name']).toBe('GetCart');
    // The session cookie authorizes the cart op — and NO CSRF / fraud header.
    expect(init.headers.Cookie).toBe('gsession=xyz');
    expect(init.headers['x-sig-fraud-check']).toBeUndefined();

    const batch = JSON.parse(init.body);
    expect(Array.isArray(batch)).toBe(true);
    expect(batch).toHaveLength(1);
    expect(batch[0].operationName).toBe('GetCart');
    expect(batch[0].variables).toEqual({});
    expect(batch[0].extensions.persistedQuery.sha256Hash).toBe(GET_CART_HASH);

    expect(cart).toEqual({ items: [], __typename: 'Cart' });
  });

  it('getCart reads the env cookie without touching the bridge', async () => {
    process.env.GROUPON_SESSION_COOKIE = 'envcookie=1';
    const fetchImpl = vi.fn().mockResolvedValue(cartRes());
    // No injected cookie: it must fall back to the env var (still no bridge).
    const client = new GrouponWebClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.getCart();
    expect(fetchImpl.mock.calls[0][1].headers.Cookie).toBe('envcookie=1');
  });

  it('addToCart POSTs the createOrUpdateCartItem hash with the resolved ids', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(200, [{ data: { createOrUpdateCartItem: { success: true } } }]));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await client.addToCart({
      optionId: 'opt-1',
      dealUuid: 'deal-uuid',
      optionUuid: 'opt-uuid',
      quantity: 2,
      isGift: false,
    });

    const init = fetchImpl.mock.calls[0][1];
    expect(init.headers['x-operation-name']).toBe('createOrUpdateCartItem');
    const op = JSON.parse(init.body)[0];
    expect(op.operationName).toBe('createOrUpdateCartItem');
    expect(op.extensions.persistedQuery.sha256Hash).toBe(CREATE_OR_UPDATE_CART_ITEM_HASH);
    expect(op.variables).toEqual({
      optionId: 'opt-1',
      dealUuid: 'deal-uuid',
      optionUuid: 'opt-uuid',
      quantity: 2,
      isGift: false,
    });
  });

  it('deleteCartItem POSTs the deleteCartItem hash with the optionId', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(200, [{ data: { deleteCartItem: { success: true } } }]));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await client.deleteCartItem({ optionId: 'opt-9' });

    const init = fetchImpl.mock.calls[0][1];
    expect(init.headers['x-operation-name']).toBe('deleteCartItem');
    const op = JSON.parse(init.body)[0];
    expect(op.operationName).toBe('deleteCartItem');
    expect(op.extensions.persistedQuery.sha256Hash).toBe(DELETE_CART_ITEM_HASH);
    expect(op.variables).toEqual({ optionId: 'opt-9' });
  });

  it('throws SessionExpiredError on a 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(401, { error: 'unauthorized' }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.getCart()).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('throws SessionExpiredError on a 403', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(403, { error: 'forbidden' }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.getCart()).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('throws SessionExpiredError on a logged-out (null getCart) shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(200, [{ data: { getCart: null } }]));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.getCart()).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('SessionExpiredError carries an actionable re-auth hint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(403, {}));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.getCart()).rejects.toMatchObject({
      hint: expect.stringMatching(/groupon\.com/i),
    });
  });

  it('maps a stale persisted hash (PersistedQueryNotFound) to an actionable error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(200, [{ errors: [{ message: 'PersistedQueryNotFound' }] }]));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.getCart()).rejects.toThrow(/stale/i);
  });

  it('refuses to blind-parse a non-JSON 2xx (bot/challenge interstitial)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('<html>challenge</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(client.getCart()).rejects.toThrow(/non-JSON/i);
  });

  it('retries once on 503 honoring the pacer, then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(503, {}, { 'retry-after': '1' }))
      .mockResolvedValueOnce(cartRes());
    const sleeps: number[] = [];
    const client = new GrouponWebClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cookie: 'c=1',
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const cart = await client.getCart();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1000]);
    expect(cart).toEqual({ items: [], __typename: 'Cart' });
  });
});
