import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestHarness, parseToolResult, type TestHarness } from '@chrischall/mcp-utils/test';
import type { ElicitResult } from '@modelcontextprotocol/server';
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

/**
 * A harness with no elicitation handler is a client that cannot show a
 * confirmation prompt (claude.ai / Claude Desktop): under the default
 * MCP_CONFIRM_MODE=ask-user every write goes through the two-phase token flow.
 */
function harness(
  webClient: GrouponWebClient,
  readClient: GrouponClient,
  elicitation?: () => ElicitResult | Promise<ElicitResult>,
) {
  return createTestHarness(
    (s) => registerCartTools(s, webClient, readClient),
    elicitation ? { elicitation } : {},
  );
}

type Json = Record<string, unknown>;

/** Phase 1: call without a token; must be a no-op preview carrying a token. */
async function phaseOne(h: TestHarness, tool: string, args: Json): Promise<Json> {
  const res = await h.callTool(tool, args);
  expect(res.isError).toBeFalsy();
  const data = parseToolResult<Json>(res);
  expect(data.status).toBe('confirmation-required');
  expect(data.dispatched).toBe(false);
  expect(typeof data.confirmToken).toBe('string');
  return data;
}

/** Both phases: preview, then the same call with the returned confirmToken. */
async function confirmed(h: TestHarness, tool: string, args: Json = {}) {
  const { confirmToken } = await phaseOne(h, tool, args);
  return h.callTool(tool, { ...args, confirmToken });
}

const ENV_KEYS = ['MCP_CONFIRM_MODE', 'MCP_CONFIRM_TTL_SECONDS', 'MCP_CONFIRM_SECRET'] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('resolveCartItem', () => {
  it('maps deal.uuid + the chosen option id/uuid and display fields', () => {
    expect(resolveCartItem(deal, 'opt-a')).toMatchObject({
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

  it('defaults to the only option of a single-option deal', () => {
    const single = { uuid: 'd', options: [{ id: 'o', uuid: 'ou', title: 'Only' }] } as unknown as GetDeal;
    expect(resolveCartItem(single)).toMatchObject({ optionId: 'o', optionUuid: 'ou' });
  });

  it('refuses to guess an option on a multi-option deal, listing the ids + titles', () => {
    // Silently picking options[0] put the wrong item in the cart whenever the
    // caller meant a different option but had no id to pass.
    expect(() => resolveCartItem(deal)).toThrow(/choose an option/i);
    try {
      resolveCartItem(deal);
      throw new Error('expected resolveCartItem to throw');
    } catch (e) {
      const hint = (e as { hint?: string }).hint ?? '';
      expect(hint).toMatch(/opt-a/);
      expect(hint).toMatch(/opt-b/);
      expect(hint).toMatch(/60-Minute/);
    }
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
  it('PHASE 1: resolves via getDeal, previews with a confirmToken, and makes NO cart mutation', async () => {
    const { webClient, readClient, getDeal, addToCart, getCart } = makeClients();
    const h = await harness(webClient, readClient);

    const data = await phaseOne(h, 'groupon_purchase', {
      dealId: 'https://www.groupon.com/deals/versailles-massage-bar-1',
      optionId: 'opt-a',
    });

    // getDeal (a READ) runs to resolve the option; the URL is stripped to a slug.
    expect(getDeal.mock.calls[0][0]).toEqual({ dealId: 'versailles-massage-bar-1' });
    // NO mutation on the preview path.
    expect(addToCart).not.toHaveBeenCalled();
    expect(getCart).not.toHaveBeenCalled();

    expect(data.action).toBe('groupon.purchase');
    const preview = data.preview as Json;
    expect(preview).toMatchObject({
      deal: 'Versailles Massage Bar',
      option: 'One 30-Minute Deep-Tissue Massage',
      optionId: 'opt-a',
      quantity: 1,
      isGift: false,
      price: { amount: 3700, currencyCode: 'USD' },
      strikeThroughPrice: { amount: 6000, currencyCode: 'USD' },
      discount: '-38%',
    });
    expect(String(preview.note)).toMatch(/checkout URL/i);
    await h.close();
  });

  it('PHASE 2: the returned confirmToken performs the add exactly once', async () => {
    const { webClient, readClient, addToCart } = makeClients({
      getCart: vi.fn().mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ items: [{ optionId: 'opt-a' }] }),
    });
    const h = await harness(webClient, readClient);
    const args = { dealId: 'versailles-massage-bar-1', optionId: 'opt-a' };

    const { confirmToken } = await phaseOne(h, 'groupon_purchase', args);
    expect(addToCart).not.toHaveBeenCalled();
    const res = await h.callTool('groupon_purchase', { ...args, confirmToken });

    expect(addToCart).toHaveBeenCalledTimes(1);
    expect(parseToolResult<Json>(res)).toMatchObject({ added: true, verified: true });
    await h.close();
  });

  it('refuses a replayed confirmToken with TOKEN_REUSED and does not add again', async () => {
    const { webClient, readClient, addToCart } = makeClients();
    const h = await harness(webClient, readClient);
    const args = { dealId: 'versailles-massage-bar-1', optionId: 'opt-a' };

    const { confirmToken } = await phaseOne(h, 'groupon_purchase', args);
    await h.callTool('groupon_purchase', { ...args, confirmToken });
    expect(addToCart).toHaveBeenCalledTimes(1);

    const replay = await h.callTool('groupon_purchase', { ...args, confirmToken });
    expect(replay.isError).toBe(true);
    expect(parseToolResult<Json>(replay).error).toBe('TOKEN_REUSED');
    expect(addToCart).toHaveBeenCalledTimes(1);
    await h.close();
  });

  it('refuses a token whose arguments changed between phases with DRAFT_CHANGED', async () => {
    const { webClient, readClient, addToCart } = makeClients();
    const h = await harness(webClient, readClient);

    const { confirmToken } = await phaseOne(h, 'groupon_purchase', {
      dealId: 'versailles-massage-bar-1',
      optionId: 'opt-a',
    });
    const res = await h.callTool('groupon_purchase', {
      dealId: 'versailles-massage-bar-1',
      optionId: 'opt-a',
      quantity: 5,
      confirmToken,
    });

    expect(res.isError).toBe(true);
    const data = parseToolResult<Json>(res);
    expect(data.error).toBe('DRAFT_CHANGED');
    expect((data.preview as Json).quantity).toBe(5);
    expect(addToCart).not.toHaveBeenCalled();
    await h.close();
  });

  it('refuses with DRAFT_CHANGED when the deal price changed between phases', async () => {
    const repriced = {
      ...deal,
      options: [{ ...(deal.options as Json[])[0], unformattedPrice: { amount: 4500, currencyCode: 'USD' } }],
    } as unknown as GetDeal;
    const getDeal = vi.fn().mockResolvedValueOnce(deal).mockResolvedValueOnce(repriced);
    const { webClient, readClient, addToCart } = makeClients({ getDeal });
    const h = await harness(webClient, readClient);
    const args = { dealId: 'versailles-massage-bar-1', optionId: 'opt-a' };

    const { confirmToken } = await phaseOne(h, 'groupon_purchase', args);
    const res = await h.callTool('groupon_purchase', { ...args, confirmToken });

    expect(parseToolResult<Json>(res).error).toBe('DRAFT_CHANGED');
    expect(addToCart).not.toHaveBeenCalled();
    await h.close();
  });

  it('adds after an accepted elicitation prompt (a client that can be asked)', async () => {
    const { webClient, readClient, addToCart } = makeClients();
    const h = await harness(webClient, readClient, async () => ({ action: 'accept', content: { confirmed: true } }));

    const res = await h.callTool('groupon_purchase', { dealId: 'versailles-massage-bar-1', optionId: 'opt-a' });

    expect(res.isError).toBeFalsy();
    expect(addToCart).toHaveBeenCalledTimes(1);
    expect(parseToolResult<Json>(res).added).toBe(true);
    await h.close();
  });

  it('does not add when the elicitation prompt is declined', async () => {
    const { webClient, readClient, addToCart } = makeClients();
    const h = await harness(webClient, readClient, async () => ({ action: 'decline' }));

    await h.callTool('groupon_purchase', { dealId: 'versailles-massage-bar-1', optionId: 'opt-a' });

    expect(addToCart).not.toHaveBeenCalled();
    await h.close();
  });

  it('MCP_CONFIRM_MODE=refuse refuses on a client that cannot be prompted', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    const { webClient, readClient, addToCart } = makeClients();
    const h = await harness(webClient, readClient);

    const res = await h.callTool('groupon_purchase', { dealId: 'versailles-massage-bar-1', optionId: 'opt-a' });

    expect(parseToolResult<Json>(res).reason).toBe('confirmation-unsupported');
    expect(addToCart).not.toHaveBeenCalled();
    await h.close();
  });

  it('errors (and mutates nothing) when optionId is omitted on a multi-option deal', async () => {
    const { webClient, readClient, addToCart } = makeClients();
    const h = await harness(webClient, readClient);

    const res = await h.callTool('groupon_purchase', { dealId: 'versailles-massage-bar-1' });

    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/opt-b/);
    expect(addToCart).not.toHaveBeenCalled();
    await h.close();
  });

  it('CONFIRMED: adds the item, re-reads the cart, and reports verified + checkout URL', async () => {
    const cartAfter = { items: [{ optionId: 'opt-b' }] };
    const { webClient, readClient, addToCart, getCart } = makeClients({
      getCart: vi.fn().mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce(cartAfter),
    });
    const h = await harness(webClient, readClient);

    const res = await confirmed(h, 'groupon_purchase', {
      dealId: 'versailles-massage-bar-1',
      optionId: 'opt-b',
      quantity: 3,
      isGift: true,
    });

    expect(addToCart).toHaveBeenCalledWith({
      optionId: 'opt-b',
      dealUuid: 'deal-uuid-1',
      optionUuid: 'opt-b-uuid',
      quantity: 3,
      isGift: true,
    });
    // Snapshot before + re-read after, to verify the add landed.
    expect(getCart).toHaveBeenCalledTimes(2);

    const data = parseToolResult<Record<string, unknown>>(res);
    expect(data.added).toBe(true);
    expect(data.verified).toBe(true);
    expect(data.checkoutUrl).toBe('https://www.groupon.com/checkout/cart');
    expect(String(data.note)).toMatch(/cannot place the order/i);
    await h.close();
  });

  it('does not report verified when the option was already in the cart and the quantity did not change', async () => {
    // The add was a no-op (e.g. a per-customer cap) but the id was already
    // present from earlier, so a presence-only check said verified: true.
    const getCart = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ optionId: 'opt-b', quantity: 1 }] })
      .mockResolvedValueOnce({ items: [{ optionId: 'opt-b', quantity: 1 }] });
    const { webClient, readClient } = makeClients({ getCart });
    const h = await harness(webClient, readClient);

    const res = await confirmed(h, 'groupon_purchase', {
      dealId: 'versailles-massage-bar-1',
      optionId: 'opt-b',
      quantity: 3,
    });

    const data = parseToolResult<Record<string, unknown>>(res);
    expect(data.verified).toBe(false);
    expect(data.quantityInCart).toBe(1);
    expect(String(data.note)).toMatch(/quantity/i);
    await h.close();
  });

  it('verifies against the line quantity and reports it (incremented from an existing line)', async () => {
    const getCart = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ optionId: 'opt-b', quantity: 1 }] })
      .mockResolvedValueOnce({ items: [{ optionId: 'opt-b', quantity: 4 }] });
    const { webClient, readClient } = makeClients({ getCart });
    const h = await harness(webClient, readClient);

    const res = await confirmed(h, 'groupon_purchase', {
      dealId: 'versailles-massage-bar-1',
      optionId: 'opt-b',
      quantity: 3,
    });

    const data = parseToolResult<Record<string, unknown>>(res);
    expect(data.verified).toBe(true);
    expect(data.quantityInCart).toBe(4);
    await h.close();
  });

  it('verifies a line whose quantity was set to the requested value', async () => {
    const getCart = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ optionId: 'opt-b', quantity: 1 }] })
      .mockResolvedValueOnce({ items: [{ optionId: 'opt-b', quantity: 3 }] });
    const { webClient, readClient } = makeClients({ getCart });
    const h = await harness(webClient, readClient);

    const res = await confirmed(h, 'groupon_purchase', {
      dealId: 'versailles-massage-bar-1',
      optionId: 'opt-b',
      quantity: 3,
    });

    expect(parseToolResult<Record<string, unknown>>(res)).toMatchObject({ verified: true, quantityInCart: 3 });
    await h.close();
  });

  it('does not verify a pre-existing line with no readable quantity', async () => {
    // Presence alone proves nothing when the item was there before the add.
    const getCart = vi.fn().mockResolvedValue({ items: [{ optionId: 'opt-b' }] });
    const { webClient, readClient } = makeClients({ getCart });
    const h = await harness(webClient, readClient);

    const res = await confirmed(h, 'groupon_purchase', {
      dealId: 'versailles-massage-bar-1',
      optionId: 'opt-b',
    });

    expect(parseToolResult<Record<string, unknown>>(res).verified).toBe(false);
    await h.close();
  });

  it('surfaces a rejected add as a tool error, never as added:true', async () => {
    const { McpToolError } = await import('@chrischall/mcp-utils');
    const addToCart = vi.fn().mockRejectedValue(new McpToolError('Groupon cart rejected the change: quantity limit exceeded'));
    const { webClient, readClient } = makeClients({ addToCart });
    const h = await harness(webClient, readClient);

    const res = await confirmed(h, 'groupon_purchase', {
      dealId: 'versailles-massage-bar-1',
      optionId: 'opt-b',
    });

    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/quantity limit exceeded/);
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

    const res = await confirmed(h, 'groupon_purchase', {
      dealId: 'versailles-massage-bar-1',
      optionId: 'opt-b',
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
      getCart: vi.fn().mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce(cartAfter),
    });
    const h = await harness(webClient, readClient);

    const res = await confirmed(h, 'groupon_purchase', {
      dealId: 'versailles-massage-bar-1',
      optionId: 'opt-b',
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

    const res = await confirmed(h, 'groupon_purchase', {
      dealId: 'versailles-massage-bar-1',
      optionId: 'opt-b',
    });

    const data = parseToolResult<Record<string, unknown>>(res);
    expect(data.verified).toBe(false);
    await h.close();
  });

  it('CONFIRMED: reports verified=false when the re-read does not show the item', async () => {
    const { webClient, readClient } = makeClients({ getCart: vi.fn().mockResolvedValue({ items: [] }) });
    const h = await harness(webClient, readClient);

    const res = await confirmed(h, 'groupon_purchase', { dealId: 'versailles-massage-bar-1', optionId: 'opt-a' });

    const data = parseToolResult<Record<string, unknown>>(res);
    expect(data.added).toBe(true);
    expect(data.verified).toBe(false);
    expect(String(data.note)).toMatch(/did not confirm/i);
    await h.close();
  });
});

describe('groupon_clear_cart', () => {
  it('PHASE 1: lists what would be removed with a confirmToken and deletes nothing', async () => {
    const cart = { items: [{ optionId: 'opt-a' }, { optionId: 'opt-b' }] };
    const { webClient, readClient, deleteCartItem } = makeClients({ getCart: vi.fn().mockResolvedValue(cart) });
    const h = await harness(webClient, readClient);

    const data = await phaseOne(h, 'groupon_clear_cart', {});

    expect(deleteCartItem).not.toHaveBeenCalled();
    expect(data.action).toBe('groupon.clear_cart');
    const preview = data.preview as Json;
    expect(preview.itemCount).toBe(2);
    expect(preview.optionIds).toEqual(['opt-a', 'opt-b']);
    expect(String(preview.note)).toMatch(/removed/i);
    await h.close();
  });

  it('PHASE 2: the returned confirmToken removes each line exactly once', async () => {
    const getCart = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ optionId: 'opt-a' }] }) // phase 1 preview
      .mockResolvedValueOnce({ items: [{ optionId: 'opt-a' }] }) // phase 2 fresh read
      .mockResolvedValueOnce({ items: [] }); // verify
    const { webClient, readClient, deleteCartItem } = makeClients({ getCart });
    const h = await harness(webClient, readClient);

    const { confirmToken } = await phaseOne(h, 'groupon_clear_cart', {});
    expect(deleteCartItem).not.toHaveBeenCalled();
    const res = await h.callTool('groupon_clear_cart', { confirmToken });

    expect(deleteCartItem).toHaveBeenCalledTimes(1);
    expect(parseToolResult<Json>(res)).toMatchObject({ cleared: true, verified: true, removed: 1 });
    await h.close();
  });

  it('refuses with DRAFT_CHANGED when the cart changed between phases', async () => {
    const getCart = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ optionId: 'opt-a' }] })
      .mockResolvedValueOnce({ items: [{ optionId: 'opt-a' }, { optionId: 'opt-new' }] });
    const { webClient, readClient, deleteCartItem } = makeClients({ getCart });
    const h = await harness(webClient, readClient);

    const { confirmToken } = await phaseOne(h, 'groupon_clear_cart', {});
    const res = await h.callTool('groupon_clear_cart', { confirmToken });

    expect(parseToolResult<Json>(res).error).toBe('DRAFT_CHANGED');
    expect(deleteCartItem).not.toHaveBeenCalled();
    await h.close();
  });

  it('CONFIRMED: deletes each line item, re-reads, and verifies empty', async () => {
    const getCart = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ optionId: 'opt-a' }, { optionId: 'opt-b' }] }) // phase 1 preview
      .mockResolvedValueOnce({ items: [{ optionId: 'opt-a' }, { optionId: 'opt-b' }] })
      .mockResolvedValueOnce({ items: [] });
    const { webClient, readClient, deleteCartItem } = makeClients({ getCart });
    const h = await harness(webClient, readClient);

    const res = await confirmed(h, 'groupon_clear_cart');

    expect(deleteCartItem.mock.calls.map((c) => c[0])).toEqual([{ optionId: 'opt-a' }, { optionId: 'opt-b' }]);
    expect(getCart).toHaveBeenCalledTimes(3); // preview + fresh list + verify
    const data = parseToolResult<Record<string, unknown>>(res);
    expect(data).toMatchObject({ cleared: true, verified: true, removed: 2 });
    await h.close();
  });

  it('CONFIRMED: reports verified=false + remaining when a re-read still shows items', async () => {
    const getCart = vi.fn().mockResolvedValue({ items: [{ optionId: 'opt-a' }] });
    const { webClient, readClient } = makeClients({ getCart });
    const h = await harness(webClient, readClient);

    const res = await confirmed(h, 'groupon_clear_cart');

    const data = parseToolResult<Record<string, unknown>>(res);
    expect(data).toMatchObject({ cleared: true, verified: false, removed: 1, remaining: ['opt-a'] });
    await h.close();
  });

  it('CONFIRMED: a delete failing partway reports which lines were already removed', async () => {
    const { McpToolError } = await import('@chrischall/mcp-utils');
    const getCart = vi.fn().mockResolvedValue({ items: [{ optionId: 'opt-a' }, { optionId: 'opt-b' }, { optionId: 'opt-c' }] });
    const deleteCartItem = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        new McpToolError('Groupon rejected the remove from cart request: cart item not found.', {
          hint: 'The rejected change to this item was not applied.',
        }),
      );
    const { webClient, readClient } = makeClients({ getCart, deleteCartItem });
    const h = await harness(webClient, readClient);

    const res = await confirmed(h, 'groupon_clear_cart');

    expect(res.isError).toBe(true);
    expect(deleteCartItem).toHaveBeenCalledTimes(2); // stops at the failure
    const text = JSON.stringify(res.content);
    expect(text).toMatch(/cart item not found/);
    expect(text).toMatch(/1 of 3/);
    expect(text).toMatch(/removed: opt-a/);
    expect(text).toMatch(/still in the cart: opt-b, opt-c/);
    expect(text).not.toMatch(/Nothing was changed/);
    await h.close();
  });

  it('short-circuits an already-empty cart with no confirmation and no deletes', async () => {
    const { webClient, readClient, deleteCartItem } = makeClients({ getCart: vi.fn().mockResolvedValue({ items: [] }) });
    const h = await harness(webClient, readClient);

    const res = await h.callTool('groupon_clear_cart', {});

    expect(deleteCartItem).not.toHaveBeenCalled();
    expect(parseToolResult<Record<string, unknown>>(res)).toMatchObject({ cleared: true, removed: 0 });
    await h.close();
  });
});
