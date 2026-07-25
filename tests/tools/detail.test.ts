import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerDetailTools, stripDealId } from '../../src/tools/detail.js';
import { client } from '../../src/client.js';

afterEach(() => vi.restoreAllMocks());

/** A fat deal the way getDeal returns it. */
const fatDeal = {
  id: 'd-1',
  uuid: 'u-1',
  title: 'Sixty-Minute Swedish Massage',
  subtitle: 'At Serenity Spa in Midtown',
  dealUrl: 'https://www.groupon.com/deals/massage-1',
  price: { amount: 4500, formattedAmount: '$45' },
  merchant: { name: 'Serenity Spa', id: 'm-1', rating: { value: 4.5 } },
  division: { id: 'new-york', name: 'New York' },
  rating: { value: 4.5, count: 210 },
  options: [
    { id: 'opt-1', title: '60-min massage', price: { formattedAmount: '$45' }, junk: true },
    { id: 'opt-2', title: '90-min massage', price: { formattedAmount: '$65' }, junk: true },
  ],
  images: ['a', 'b', 'c'],
  aiReviewSummary: { text: 'blob' },
  representativeReview: { text: 'blob' },
  badges: ['best-seller'],
  status: 'open',
};

describe('stripDealId', () => {
  it('returns a bare slug unchanged', () => {
    expect(stripDealId('enset-productions-and-ventures-3')).toBe('enset-productions-and-ventures-3');
  });
  it('extracts the last path segment from a full deal URL', () => {
    expect(stripDealId('https://www.groupon.com/deals/massage-1')).toBe('massage-1');
  });
  it('strips query strings and trailing slashes', () => {
    expect(stripDealId('https://www.groupon.com/deals/massage-1/?utm=x')).toBe('massage-1');
  });
});

describe('groupon_get_deal', () => {
  it('returns the full deal by default and strips a URL to a slug', async () => {
    const spy = vi.spyOn(client, 'getDeal').mockResolvedValue(fatDeal);
    const h = await createTestHarness((s) => registerDetailTools(s, client));

    const res = await h.callTool('groupon_get_deal', {
      dealId: 'https://www.groupon.com/deals/massage-1',
    });

    expect(spy.mock.calls[0][0]).toEqual({ dealId: 'massage-1', optionId: undefined });
    const data = parseToolResult<typeof fatDeal>(res);
    expect(data).toEqual(fatDeal);
    expect(data).toHaveProperty('images');
    await h.close();
  });

  it('passes optionId and a bare slug through unchanged', async () => {
    const spy = vi.spyOn(client, 'getDeal').mockResolvedValue(fatDeal);
    const h = await createTestHarness((s) => registerDetailTools(s, client));

    await h.callTool('groupon_get_deal', { dealId: 'massage-1', optionId: 'opt-2' });

    expect(spy.mock.calls[0][0]).toEqual({ dealId: 'massage-1', optionId: 'opt-2' });
    await h.close();
  });

  it('projects a compact view when compact=true', async () => {
    vi.spyOn(client, 'getDeal').mockResolvedValue(fatDeal);
    const h = await createTestHarness((s) => registerDetailTools(s, client));

    const res = await h.callTool('groupon_get_deal', { dealId: 'massage-1', compact: true });

    const data = parseToolResult<Record<string, unknown>>(res);
    expect(data).toEqual({
      title: 'Sixty-Minute Swedish Massage',
      subtitle: 'At Serenity Spa in Midtown',
      merchantName: 'Serenity Spa',
      price: { amount: 4500, formattedAmount: '$45' },
      rating: { value: 4.5, count: 210 },
      division: { id: 'new-york', name: 'New York' },
      options: [
        { title: '60-min massage', price: { formattedAmount: '$45' } },
        { title: '90-min massage', price: { formattedAmount: '$65' } },
      ],
      url: 'https://www.groupon.com/deals/massage-1',
    });
    // Fat fields dropped.
    expect(data).not.toHaveProperty('images');
    expect(data).not.toHaveProperty('badges');
    await h.close();
  });

  it('drift fallback: when options is mis-shaped, compact returns the RAW deal and warns', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deal = { title: 'X', options: { not: 'an array' } } as unknown as Awaited<
      ReturnType<typeof client.getDeal>
    >;
    vi.spyOn(client, 'getDeal').mockResolvedValue(deal);
    const h = await createTestHarness((s) => registerDetailTools(s, client));

    const res = await h.callTool('groupon_get_deal', { dealId: 'x', compact: true });

    const data = parseToolResult<typeof deal>(res);
    expect(data).toEqual(deal);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('options'));
    await h.close();
  });
});

describe('groupon_list_categories', () => {
  const navPayload = {
    navigation: [
      {
        title: 'Food & Drink',
        url: '/food',
        junk: 'x',
        children: [{ title: 'Restaurants', url: '/food/restaurants', extra: 1 }],
      },
      { title: 'Beauty & Spas', url: '/beauty' },
    ],
    __typename: 'Navigation',
  };

  it('returns the full taxonomy payload by default', async () => {
    vi.spyOn(client, 'getMainNavigation').mockResolvedValue(navPayload);
    const h = await createTestHarness((s) => registerDetailTools(s, client));

    const res = await h.callTool('groupon_list_categories', {});

    const data = parseToolResult<typeof navPayload>(res);
    expect(data).toEqual(navPayload);
    await h.close();
  });

  it('projects a compact {title, url, children} tree when compact=true', async () => {
    vi.spyOn(client, 'getMainNavigation').mockResolvedValue(navPayload);
    const h = await createTestHarness((s) => registerDetailTools(s, client));

    const res = await h.callTool('groupon_list_categories', { compact: true });

    const data = parseToolResult<{ navigation: Record<string, unknown>[] }>(res);
    expect(data).toEqual({
      navigation: [
        {
          title: 'Food & Drink',
          url: '/food',
          children: [{ title: 'Restaurants', url: '/food/restaurants' }],
        },
        { title: 'Beauty & Spas', url: '/beauty' },
      ],
    });
    await h.close();
  });

  it('drift fallback: when navigation is missing, compact returns RAW and warns', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const nav = { somethingElse: true } as unknown as Awaited<
      ReturnType<typeof client.getMainNavigation>
    >;
    vi.spyOn(client, 'getMainNavigation').mockResolvedValue(nav);
    const h = await createTestHarness((s) => registerDetailTools(s, client));

    const res = await h.callTool('groupon_list_categories', { compact: true });

    const data = parseToolResult<typeof nav>(res);
    expect(data).toEqual(nav);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('navigation array is missing'));
    await h.close();
  });
});
