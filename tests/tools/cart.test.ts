import { describe, it, expect, vi } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerCartTools, resolveCartItem, collectCartOptionIds } from '../../src/tools/cart.js';
import type { GrouponClient, GetDeal } from '../../src/client.js';
import type { GrouponWebClient } from '../../src/web-client.js';

// A getDeal payload shaped like the LIVE response (verified 2026-07-25): the
// deal carries `uuid`; each option carries `id` + `uuid` (equal for the observed
// deal, but read independently here) and `unformattedPrice`.
const deal = {
  id: 'versailles-massage-bar-1',
  uuid: 'deal-uuid-1',
  title: 'Versailles Massage Bar',
  options: [
    {
      id: 'opt-a',
      uuid: 'opt-a-uuid',
      title: 'One 30-Minute Deep-Tissue Massage',
      unformattedPrice: { amount: 3700, currencyCode: 'USD' },
      unformattedStrikeThroughPrice: { amount: 6000, currencyCode: 'USD' },
      discount: '-38%',
      isSoldOut: false,
      cartable: true,
    },
    {
      id: 'opt-b',
      uuid: 'opt-b-uuid',
      title: 'One 60-Minute Deep-Tissue Massage',
      unformattedPrice: { amount: 6000, currencyCode: 'USD' },
      isSoldOut: false,
    },
  ],
} as unknown as GetDeal;

/** Build loosely-typed mock clients; override any method per test. */
function makeClients(over: {
  getCart?: ReturnType<typeof vi.fn>;
  addToCart?: ReturnType<typeof vi.fn>;
  deleteCartItem?: ReturnType<typeof vi.fn>;
  getDeal?: ReturnType<typeof vi.fn>;
} = {}) {
  const getCart = over.getCart ?? vi.fn().mockResolvedValue({ items: [] });
  const addToCart = over.addToCart ?? vi.fn().mockResolvedValue({});
  const deleteCartItem = over.deleteCartItem ?? vi.fn().mockResolvedValue({});
  const getDeal = over.getDeal ?? vi.fn().mockResolvedValue(deal);
  const webClient = { getCart, addToCart, deleteCartItem } as unknown as GrouponWebClient;
  const readClient = { getDeal } as unknown as GrouponClient;
  return { webClient, readClient, getCart, addToCart, deleteCartItem, getDeal };
}

function harness(webClient: GrouponWebClient, readClient: GrouponClient) {
  return createTestHarness((s) => registerCartTools(s, webClient, readClient));
}

describe('resolveCartItem', () => {
  it('defaults to the first option and maps deal.uuid + option id/uuid', () => {
    expect(resolveCartItem(deal)).toMatchObject({
      dealUuid: 'deal-uuid-1',
      optionId: 'opt-a',
      optionUuid: 'opt-a-uuid',
      dealTitle: 'Versailles Massage Bar',
      optionTitle: 'One 30-Minute Deep-Tissue Massage',
      price: { amount: 3700, currencyCode: 'USD' },
      strikeThroughPrice: { amount: 6000, currencyCode: 'USD' },
      discount: '-38%',
    });
  });

  it('selects a requested option by id', () => {
    expect(resolveCartItem(deal, 'opt-b')).toMatchObject({ optionId: 'opt-b', optionUuid: 'opt-b-uuid' });
  });

  it('selects a requested option by uuid', () => {
    expect(resolveCartItem(deal, 'opt-b-uuid')).toMatchObject({ optionId: 'opt-b', optionUuid: 'opt-b-uuid' });
  });

  it('throws with the available ids when the requested option is unknown', () => {
    expect(() => resolveCartItem(deal, 'nope')).toThrow(/not found/i);
    try {
      resolveCartItem(deal, 'nope');
      throw new Error('expected resolveCartItem to throw');
    } catch (e) {
      expect((e as { hint?: string }).hint).toMatch(/opt-a/);
    }
  });

  it('throws when the deal has no uuid', () => {
    expect(() => resolveCartItem({ options: deal.options as unknown[] } as GetDeal)).toThrow(/deal UUID/i);
  });

  it('throws when the deal has no options', () => {
    expect(() => resolveCartItem({ uuid: 'x', options: [] } as unknown as GetDeal)).toThrow(/no purchasable/i);
  });

  it('throws when the chosen option is sold out', () => {
    const soldOut = { uuid: 'd', options: [{ id: 'o', uuid: 'ou', isSoldOut: true }] } as unknown as GetDeal;
    expect(() => resolveCartItem(soldOut)).toThrow(/sold out/i);
  });
});

describe('collectCartOptionIds', () => {
  it('collects nested optionIds, de-duplicates, and is cycle-safe', () => {
    const cart: Record<string, unknown> = {
      items: [{ optionId: 'a', qty: 1 }, { deal: { optionId: 'b' } }, { optionId: 'a' }],
    };
    cart.self = cart; // cycle
    expect(collectCartOptionIds(cart).sort()).toEqual(['a', 'b']);
  });

  it('returns [] for an empty / itemless cart', () => {
    expect(collectCartOptionIds({ items: [] })).toEqual([]);
    expect(collectCartOptionIds(null)).toEqual([]);
  });
});

describe('groupon_view_cart', () => {
  it('reads and returns the cart', async () => {
    const cart = { items: [{ optionId: 'opt-a' }], __typename: 'Cart' };
    const { webClient, readClient, getCart } = makeClients({ getCart: vi.fn().mockResolvedValue(cart) });
    const h = await harness(webClient, readClient);

    const res = await h.callTool('groupon_view_cart', {});

    expect(getCart).toHaveBeenCalledTimes(1);
    expect(parseToolResult<typeof cart>(res)).toEqual(cart);
    await h.close();
  });
});

describe('groupon_purchase', () => {
  it('DRY RUN: resolves via getDeal, previews, and makes NO cart mutation', async () => {
    const { webClient, readClient, getDeal, addToCart, getCart } = makeClients();
    const h = await harness(webClient, readClient);

    const res = await h.callTool('groupon_purchase', {
      dealId: 'https://www.groupon.com/deals/versailles-massage-bar-1',
    });

    // getDeal (a READ) runs to resolve the option; the URL is stripped to a slug.
    expect(getDeal.mock.calls[0][0]).toEqual({ dealId: 'versailles-massage-bar-1' });
    // NO mutation on the dry-run path.
    expect(addToCart).not.toHaveBeenCalled();
    expect(getCart).not.toHaveBeenCalled();

    const data = parseToolResult<Record<string, unknown>>(res);
    expect(data.preview).toBe(true);
    expect(data.optionId).toBe('opt-a');
    expect(data.quantity).toBe(1);
    expect(data.price).toEqual({ amount: 3700, currencyCode: 'USD' });
    await h.close();
  });

  it('CONFIRM: adds the item, re-reads the cart, and reports verified + checkout URL', async () => {
    const cartAfter = { items: [{ optionId: 'opt-b' }] };
    const { webClient, readClient, addToCart, getCart } = makeClients({
      getCart: vi.fn().mockResolvedValue(cartAfter),
    });
    const h = await harness(webClient, readClient);

    const res = await h.callTool('groupon_purchase', {
      dealId: 'versailles-massage-bar-1',
      optionId: 'opt-b',
      quantity: 3,
      isGift: true,
      confirm: true,
    });

    expect(addToCart).toHaveBeenCalledWith({
      optionId: 'opt-b',
      dealUuid: 'deal-uuid-1',
      optionUuid: 'opt-b-uuid',
      quantity: 3,
      isGift: true,
    });
    // Re-read to verify the add landed.
    expect(getCart).toHaveBeenCalledTimes(1);

    const data = parseToolResult<Record<string, unknown>>(res);
    expect(data.added).toBe(true);
    expect(data.verified).toBe(true);
    expect(data.checkoutUrl).toBe('https://www.groupon.com/checkout/cart');
    expect(String(data.note)).toMatch(/cannot place the order/i);
    await h.close();
  });

  it('reports verified when the id is present under a differently-named field', async () => {
    // The fallback's whole reason to exist: Groupon does not always echo the id
    // back under `optionId`. Without this, the negative test below is satisfied
    // by deleting the fallback outright — the suite would stay green while
    // every legitimately-added item started reporting verified: false.
    const cartAfter = {
      items: [{ variantId: 'opt-b', quantity: 1 }],
      checkoutUrl: 'https://www.groupon.com/checkout/cart',
    };
    const { webClient, readClient } = makeClients({
      getCart: vi.fn().mockResolvedValue(cartAfter),
    });
    const h = await harness(webClient, readClient);

    const res = await h.callTool('groupon_purchase', {
      dealId: 'versailles-massage-bar-1',
      optionId: 'opt-b',
      confirm: true,
    });

    const data = parseToolResult<Record<string, unknown>>(res);
    expect(data.verified).toBe(true);
    await h.close();
  });

  it('finds a nested, differently-named id without matching a longer sibling', async () => {
    // Exact-value matching, not substring: the walk descends into nested
    // objects and arrays, and the sibling that merely STARTS with the id must
    // not satisfy it.
    const cartAfter = {
      items: [
        { sku: 'opt-b-legacy-variant' },
        { detail: { selection: { chosenOption: 'opt-b' } } },
      ],
    };
    const { webClient, readClient } = makeClients({
      getCart: vi.fn().mockResolvedValue(cartAfter),
    });
    const h = await harness(webClient, readClient);

    const res = await h.callTool('groupon_purchase', {
      dealId: 'versailles-massage-bar-1',
      optionId: 'opt-b',
      confirm: true,
    });

    expect(parseToolResult<Record<string, unknown>>(res).verified).toBe(true);
    await h.close();
  });

  it('does not report verified when the id only appears as a substring', async () => {
    // The old fallback stringified the whole cart and substring-matched, so an
    // unrelated longer id — or the id echoed in the checkout URL — read as
    // "the item is in the cart".
    const cartAfter = {
      items: [{ optionId: 'opt-b-legacy-variant' }],
      checkoutUrl: 'https://www.groupon.com/checkout/cart?last=opt-b',
    };
    const { webClient, readClient } = makeClients({
      getCart: vi.fn().mockResolvedValue(cartAfter),
    });
    const h = await harness(webClient, readClient);

    const res = await h.callTool('groupon_purchase', {
      dealId: 'versailles-massage-bar-1',
      optionId: 'opt-b',
      confirm: true,
    });

    const data = parseToolResult<Record<string, unknown>>(res);
    expect(data.verified).toBe(false);
    await h.close();
  });

  it('CONFIRM: reports verified=false when the re-read does not show the item', async () => {
    const { webClient, readClient } = makeClients({ getCart: vi.fn().mockResolvedValue({ items: [] }) });
    const h = await harness(webClient, readClient);

    const res = await h.callTool('groupon_purchase', { dealId: 'versailles-massage-bar-1', confirm: true });

    const data = parseToolResult<Record<string, unknown>>(res);
    expect(data.added).toBe(true);
    expect(data.verified).toBe(false);
    expect(String(data.note)).toMatch(/did not confirm/i);
    await h.close();
  });
});

describe('groupon_clear_cart', () => {
  it('DRY RUN: lists what would be removed and deletes nothing', async () => {
    const cart = { items: [{ optionId: 'opt-a' }, { optionId: 'opt-b' }] };
    const { webClient, readClient, deleteCartItem } = makeClients({ getCart: vi.fn().mockResolvedValue(cart) });
    const h = await harness(webClient, readClient);

    const res = await h.callTool('groupon_clear_cart', {});

    expect(deleteCartItem).not.toHaveBeenCalled();
    const data = parseToolResult<Record<string, unknown>>(res);
    expect(data.preview).toBe(true);
    expect(data.itemCount).toBe(2);
    expect(data.optionIds).toEqual(['opt-a', 'opt-b']);
    await h.close();
  });

  it('CONFIRM: deletes each line item, re-reads, and verifies empty', async () => {
    const getCart = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ optionId: 'opt-a' }, { optionId: 'opt-b' }] })
      .mockResolvedValueOnce({ items: [] });
    const { webClient, readClient, deleteCartItem } = makeClients({ getCart });
    const h = await harness(webClient, readClient);

    const res = await h.callTool('groupon_clear_cart', { confirm: true });

    expect(deleteCartItem.mock.calls.map((c) => c[0])).toEqual([{ optionId: 'opt-a' }, { optionId: 'opt-b' }]);
    expect(getCart).toHaveBeenCalledTimes(2); // list + verify
    const data = parseToolResult<Record<string, unknown>>(res);
    expect(data).toMatchObject({ cleared: true, verified: true, removed: 2 });
    await h.close();
  });

  it('CONFIRM: reports verified=false + remaining when a re-read still shows items', async () => {
    const getCart = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ optionId: 'opt-a' }] })
      .mockResolvedValueOnce({ items: [{ optionId: 'opt-a' }] });
    const { webClient, readClient } = makeClients({ getCart });
    const h = await harness(webClient, readClient);

    const res = await h.callTool('groupon_clear_cart', { confirm: true });

    const data = parseToolResult<Record<string, unknown>>(res);
    expect(data).toMatchObject({ cleared: true, verified: false, removed: 1, remaining: ['opt-a'] });
    await h.close();
  });

  it('short-circuits an already-empty cart with no confirm and no deletes', async () => {
    const { webClient, readClient, deleteCartItem } = makeClients({ getCart: vi.fn().mockResolvedValue({ items: [] }) });
    const h = await harness(webClient, readClient);

    const res = await h.callTool('groupon_clear_cart', {});

    expect(deleteCartItem).not.toHaveBeenCalled();
    expect(parseToolResult<Record<string, unknown>>(res)).toMatchObject({ cleared: true, removed: 0 });
    await h.close();
  });
});
