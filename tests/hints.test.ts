import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { client } from '../src/client.js';
import { webClient } from '../src/web-client.js';
import { registerHealthcheckTools } from '../src/tools/healthcheck.js';
import { registerDealTools } from '../src/tools/deals.js';
import { registerDetailTools } from '../src/tools/detail.js';
import { registerCartTools } from '../src/tools/cart.js';

/**
 * Context-group hints (`_meta.mint`, the mcp-host context-groups contract),
 * read off the SERVED tools/list — what a host sees — so a tool added without
 * a hint decision fails here.
 */
type Listed = {
  name: string;
  annotations?: { readOnlyHint?: boolean };
  inputSchema: { properties?: Record<string, unknown> };
  _meta?: { mint?: Record<string, unknown> };
};

const DOMAINS = ['school', 'home', 'work', 'family', 'health', 'money', 'travel', 'food'];
const INTENTS = ['whats-new', 'whats-due', 'whats-on', 'lookup', 'turn-on-off', 'send', 'change', 'other'];
const CANONICAL_INTENTS = ['whats-new', 'whats-due', 'whats-on'];
const KEYS = ['domain', 'intent', 'canonical', 'subject', 'when', 'aliases'];

/** The intent every tool declares — this table is the assertion. */
const EXPECTED_INTENT: Record<string, string> = {
  groupon_search_deals: 'lookup',
  groupon_get_deal: 'lookup',
  groupon_list_categories: 'lookup',
  groupon_view_cart: 'lookup',
  groupon_purchase: 'change',
  groupon_clear_cart: 'change',
};

let tools: Listed[];

beforeAll(async () => {
  const h = await createTestHarness((server) => {
    registerHealthcheckTools(server, client);
    registerDealTools(server, client);
    registerDetailTools(server, client);
    registerCartTools(server, webClient, client);
  });
  tools = (await h.client.listTools()).tools as Listed[];
  await h.close();
});

afterAll(() => {
  tools = [];
});

const hinted = (): Listed[] => tools.filter((t) => !t.name.endsWith('_healthcheck'));

describe('_meta.mint hints on tools/list', () => {
  it('names every served tool except the healthcheck, so a new tool cannot skip the decision', () => {
    expect(hinted().map((t) => t.name).sort()).toEqual(Object.keys(EXPECTED_INTENT).sort());
  });

  it('leaves the mcp-utils healthcheck unhinted (it joins no group)', () => {
    const hc = tools.find((t) => t.name === 'groupon_healthcheck');
    expect(hc).toBeDefined();
    expect(hc?._meta?.mint).toBeUndefined();
  });

  it.each(Object.entries(EXPECTED_INTENT))('%s declares domain food and intent %s', (name, intent) => {
    const mint = tools.find((t) => t.name === name)?._meta?.mint;
    expect(mint, name).toBeDefined();
    expect(mint!.domain).toBe('food');
    expect(mint!.intent).toBe(intent);
  });

  it('every hint is shaped per the host contract', () => {
    for (const t of hinted()) {
      const mint = t._meta!.mint!;
      const props = t.inputSchema.properties ?? {};
      expect(Object.keys(mint).filter((k) => !KEYS.includes(k)), t.name).toEqual([]);
      expect(DOMAINS, t.name).toContain(mint.domain);
      expect(INTENTS, t.name).toContain(mint.intent);
      if ('subject' in mint) expect(props, t.name).toHaveProperty(mint.subject as string);
      if ('when' in mint) {
        const when = mint.when as Record<string, string>;
        expect(Object.keys(when).sort(), t.name).toEqual(['end', 'start']);
        expect(props, t.name).toHaveProperty(when.start);
        expect(props, t.name).toHaveProperty(when.end);
      }
      if ('aliases' in mint) {
        const aliases = mint.aliases as string[];
        expect(aliases.length, t.name).toBeLessThanOrEqual(8);
        for (const a of aliases) {
          expect(a.length, t.name).toBeLessThanOrEqual(40);
          expect(a, t.name).toBe(a.toLowerCase());
        }
      }
    }
  });

  it('canonical only on a readOnly whats-new/due/on read, at most one per intent, each with a brief view', () => {
    const canonical = hinted().filter((t) => t._meta!.mint!.canonical !== undefined);
    const perIntent = new Map<string, number>();
    for (const t of canonical) {
      const mint = t._meta!.mint!;
      expect(mint.canonical, t.name).toBe(true);
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(CANONICAL_INTENTS, t.name).toContain(mint.intent);
      perIntent.set(mint.intent as string, (perIntent.get(mint.intent as string) ?? 0) + 1);
      const view = (t.inputSchema.properties ?? {}).view as { enum?: string[] } | undefined;
      expect(view?.enum, t.name).toContain('brief');
    }
    for (const [intent, n] of perIntent) expect(n, intent).toBeLessThanOrEqual(1);
  });

  it('declares no canonical read: nothing here answers a what\'s-new/due/on question', () => {
    // Groupon's surface is a public deal catalogue plus the signed-in cart: a
    // free-text search, a deal, the taxonomy, and the cart. None is a dated,
    // per-person feed, so there is nothing for a "what's new/due/on" ask to
    // fan out to; the hints place the tools in the food group as lookups and
    // cart changes only.
    expect(hinted().filter((t) => t._meta!.mint!.canonical).map((t) => t.name)).toEqual([]);
    for (const t of hinted()) expect(CANONICAL_INTENTS, t.name).not.toContain(t._meta!.mint!.intent);
  });

  it('declares no subject: Groupon has no listable set of subjects', () => {
    for (const t of hinted()) expect(t._meta!.mint, t.name).not.toHaveProperty('subject');
  });

  it('search and cart carry the everyday words a person says', () => {
    const aliases = (name: string) => tools.find((t) => t.name === name)?._meta?.mint?.aliases as string[];
    expect(aliases('groupon_search_deals')).toEqual(expect.arrayContaining(['groupon', 'deals', 'coupons']));
    expect(aliases('groupon_view_cart')).toEqual(expect.arrayContaining(['cart']));
  });
});
