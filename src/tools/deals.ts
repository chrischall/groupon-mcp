// Deal tools: search / browse Groupon's consumer deal feed. Read-only — this
// server registers no write (purchase) tools in the read-path MVP.
//
// The `groupon_search_deals` tool fronts the verified `BrowseDealFeed` op on
// Groupon's consumer GraphQL endpoint. Omit `query` for a plain category/city
// browse; pass `query` for a free-text search. `compact=true` projects each
// deal card down to a slim summary (title, url, price, merchant, rating,
// discount, locations) — recommended for browsing so the model isn't flooded
// with image-size variants, option grids, and marketing blobs.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isCompact, viewArg, viewResponse } from '../view.js';
import { minifiedResult } from '@chrischall/mcp-utils';
import { z } from 'zod';
import type { GrouponClient, BrowseDealFeed } from '../client.js';

/**
 * Fields kept by the compact deal projection. Everything fat on a card
 * (imageUrls, options, displayOptions, badges, icon, flags, categoryGuid, …)
 * is dropped; the localized price block and merchant name are extracted from
 * their sub-objects. Absent fields are simply omitted, so drift never injects
 * `undefined`s into the projection.
 */
export function compactDeal(card: unknown): Record<string, unknown> {
  const c = (card ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (c.title !== undefined) out.title = c.title;
  if (c.url !== undefined) out.url = c.url;
  // The whole localized price block is small and already localized by Groupon.
  if (c.prices !== undefined) out.prices = c.prices;
  const merchant = c.merchant as { name?: unknown } | undefined;
  if (merchant?.name !== undefined) out.merchantName = merchant.name;
  if (c.rating !== undefined) out.rating = c.rating;
  if (c.discountPercentage !== undefined) out.discountPercentage = c.discountPercentage;
  if (c.locationsSummary !== undefined) out.locationsSummary = c.locationsSummary;
  return out;
}

/**
 * Loose envelope validating ONLY the field the compact projection reads. The
 * full feed passes through untouched; unknown fields are preserved.
 */
const DealFeedEnvelope = z.looseObject({ cards: z.array(z.unknown()) });

/**
 * Project a deal feed down to slim cards. When the `cards` array isn't where we
 * expect it (Groupon response drift), warn to stderr and return the RAW feed
 * rather than an empty/wrong projection — degrade, never break.
 */
export function compactFeed(feed: BrowseDealFeed): unknown {
  const parsed = DealFeedEnvelope.safeParse(feed);
  if (!parsed.success) {
    console.error(
      '[groupon-mcp] WARNING: expected browseDealFeed.cards array is missing — returning the raw response (compact projection skipped).',
    );
    return feed;
  }
  return { cards: parsed.data.cards.map(compactDeal), pagination: feed.pagination };
}

export function registerDealTools(server: McpServer, client: GrouponClient): void {
  server.registerTool(
    'groupon_search_deals',
    {
      description:
        'Search or browse Groupon deals for a city (division). Pass `query` for a free-text search (e.g. "massage", ' +
        '"pizza"); omit it for a plain category/city browse. Set compact=true for slim deal summaries when browsing.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Free-text search term (e.g. "massage", "pizza"). Omit for a plain category/city browse.'),
        division: z
          .string()
          .default('new-york')
          .describe('Groupon city slug, e.g. new-york, chicago, syracuse.'),
        limit: z.number().int().min(1).max(100).default(24).describe('Maximum number of deals to return (1-100).'),
        offset: z.number().int().min(0).default(0).describe('Number of deals to skip for pagination (0-based).'),
        view: viewArg(),
      },
    },
    async (args) => {
      const feed = await client.browseDealFeed({
        query: args.query,
        division: args.division,
        limit: args.limit,
        offset: args.offset,
      });
      return minifiedResult(isCompact(args.view) ? compactFeed(feed) : feed);
    },
  );
}
