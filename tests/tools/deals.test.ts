import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerDealTools } from '../../src/tools/deals.js';
import { client } from '../../src/client.js';

afterEach(() => vi.restoreAllMocks());

/** A fat deal card the way BrowseDealFeed returns it. */
const fatCard = {
  id: 'deal-1',
  uuid: 'u-1',
  title: 'Sixty-Minute Swedish Massage',
  url: 'https://www.groupon.com/deals/massage-1',
  categoryGuid: 'g-1',
  prices: [{ amount: 4500, formattedAmount: '$45', currencyCode: 'USD' }],
  options: [{ id: 'opt-1' }, { id: 'opt-2' }],
  displayOptions: { some: 'blob' },
  merchant: { name: 'Serenity Spa', id: 'm-1' },
  rating: { starRating: 4.5, count: 210 },
  discountPercentage: 40,
  locationsSummary: '2 locations in New York',
  imageUrls: ['a', 'b', 'c'],
  badges: ['best-seller'],
  icon: 'x',
  flags: {},
};

describe('groupon_search_deals', () => {
  it('passes args through to browseDealFeed and returns the full feed on view:"full"', async () => {
    const feed = { cards: [fatCard], pagination: { offset: 0 }, facets: [], __typename: 'DealFeed' };
    const spy = vi.spyOn(client, 'browseDealFeed').mockResolvedValue(feed);
    const h = await createTestHarness((s) => registerDealTools(s, client));

    const res = await h.callTool('groupon_search_deals', { view: 'full', 
      query: 'massage',
      division: 'chicago',
      limit: 5,
      offset: 10,
    });

    expect(spy.mock.calls[0][0]).toEqual({ query: 'massage', division: 'chicago', limit: 5, offset: 10 });
    const data = parseToolResult<typeof feed>(res);
    expect(data).toEqual(feed);
    // Full feed keeps the fat fields.
    expect(data.cards[0]).toHaveProperty('imageUrls');
    await h.close();
  });

  it('defaults division to new-york and returns compact card projections', async () => {
    const feed = { cards: [fatCard], pagination: { offset: 0 } };
    const spy = vi.spyOn(client, 'browseDealFeed').mockResolvedValue(feed);
    const h = await createTestHarness((s) => registerDealTools(s, client));

    const res = await h.callTool('groupon_search_deals', {});

    // division default applied.
    expect(spy.mock.calls[0][0]).toEqual({ query: undefined, division: 'new-york', limit: 24, offset: 0 });

    const data = parseToolResult<{ cards: Record<string, unknown>[]; pagination: unknown }>(res);
    expect(data.cards[0]).toEqual({
      title: 'Sixty-Minute Swedish Massage',
      url: 'https://www.groupon.com/deals/massage-1',
      prices: [{ amount: 4500, formattedAmount: '$45', currencyCode: 'USD' }],
      merchantName: 'Serenity Spa',
      rating: { starRating: 4.5, count: 210 },
      discountPercentage: 40,
      locationsSummary: '2 locations in New York',
    });
    // Fat fields dropped.
    expect(data.cards[0]).not.toHaveProperty('imageUrls');
    expect(data.cards[0]).not.toHaveProperty('options');
    expect(data.pagination).toEqual({ offset: 0 });
    await h.close();
  });

  it('drift fallback: when cards is missing, compact returns the RAW feed and warns', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    // No `cards` array — Groupon changed the shape.
    const feed = { pagination: { offset: 0 }, somethingElse: true } as unknown as Awaited<
      ReturnType<typeof client.browseDealFeed>
    >;
    vi.spyOn(client, 'browseDealFeed').mockResolvedValue(feed);
    const h = await createTestHarness((s) => registerDealTools(s, client));

    const res = await h.callTool('groupon_search_deals', {});

    const data = parseToolResult<typeof feed>(res);
    expect(data).toEqual(feed);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cards array is missing'));
    await h.close();
  });
});
