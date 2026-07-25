// Deal-detail + taxonomy tools. Read-only.
//
// `groupon_get_deal` fronts the verified `getDeal` op (deal detail by permalink
// slug) — it works even though the `/deals/<slug>` PAGE 403s server-side. The
// dealId input accepts either a bare slug or a full Groupon deal URL (stripped
// to its last path segment). `compact=true` projects a slim view.
//
// `groupon_list_categories` fronts the verified `GetMainNavigation` op and
// returns Groupon's category taxonomy tree (optionally a compact {title, url,
// children} tree).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textResult } from '@chrischall/mcp-utils';
import { z } from 'zod';
import type { GrouponClient, GetDeal, MainNavigation } from '../client.js';

/**
 * Normalize a dealId input to a bare permalink slug. Accepts either a bare slug
 * (returned unchanged) or a full Groupon deal URL, from which the last path
 * segment is extracted. Query strings and fragments are stripped.
 */
export function stripDealId(input: string): string {
  // Drop any query string or fragment, then trailing slashes.
  const noQuery = input.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  const segments = noQuery.split('/');
  return segments[segments.length - 1] || noQuery;
}

/** One compact option summary: only the fields the projection reads. */
function compactOption(option: unknown): Record<string, unknown> {
  const o = (option ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (o.title !== undefined) out.title = o.title;
  if (o.price !== undefined) out.price = o.price;
  return out;
}

/**
 * Project a full deal down to a slim view (title, subtitle, merchant name,
 * price, rating, division, a few option summaries, url). Absent fields are
 * simply omitted so drift never injects `undefined`s.
 */
export function compactDealDetail(deal: GetDeal): Record<string, unknown> {
  const d = (deal ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (d.title !== undefined) out.title = d.title;
  if (d.subtitle !== undefined) out.subtitle = d.subtitle;
  const merchant = d.merchant as { name?: unknown } | undefined;
  if (merchant?.name !== undefined) out.merchantName = merchant.name;
  if (d.price !== undefined) out.price = d.price;
  if (d.rating !== undefined) out.rating = d.rating;
  else if ((merchant as { rating?: unknown } | undefined)?.rating !== undefined) {
    out.rating = (merchant as { rating?: unknown }).rating;
  }
  if (d.division !== undefined) out.division = d.division;
  if (Array.isArray(d.options)) out.options = d.options.slice(0, 5).map(compactOption);
  if (d.dealUrl !== undefined) out.url = d.dealUrl;
  else if (d.url !== undefined) out.url = d.url;
  return out;
}

/**
 * Loose envelope validating ONLY the structural field the compact projection
 * iterates: `options` must be an array when present (the projection `.map`s it).
 * Everything else passes through untouched.
 */
const DealEnvelope = z.looseObject({ options: z.array(z.unknown()).optional() });

/**
 * Project a deal down to a slim view. When `options` is present but not an array
 * (Groupon response drift), warn to stderr and return the RAW deal rather than a
 * wrong projection — degrade, never break.
 */
export function compactDeal(deal: GetDeal): unknown {
  const parsed = DealEnvelope.safeParse(deal);
  if (!parsed.success) {
    console.error(
      '[groupon-mcp] WARNING: expected getDeal.options array is missing/mis-shaped — returning the raw response (compact projection skipped).',
    );
    return deal;
  }
  return compactDealDetail(deal);
}

/**
 * Project a Groupon navigation node to `{ title, url, children }`, recursing
 * into children. Only present fields are kept. Non-object nodes pass through.
 */
function compactNavNode(node: unknown): unknown {
  const n = (node ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (n.title !== undefined) out.title = n.title;
  if (n.url !== undefined) out.url = n.url;
  const children = n.children;
  if (Array.isArray(children) && children.length > 0) {
    out.children = children.map(compactNavNode);
  }
  return out;
}

/**
 * Loose envelope validating that the navigation payload carries a `navigation`
 * array of nodes (the field the compact tree walks). Everything else passes
 * through untouched.
 */
const NavEnvelope = z.looseObject({ navigation: z.array(z.unknown()) });

/**
 * Project the navigation payload down to a compact `{ title, url, children }`
 * tree. When the `navigation` array isn't where we expect it (Groupon response
 * drift), warn to stderr and return the RAW payload — degrade, never break.
 */
export function compactNavigation(nav: MainNavigation): unknown {
  const parsed = NavEnvelope.safeParse(nav);
  if (!parsed.success) {
    console.error(
      '[groupon-mcp] WARNING: expected navigation array is missing — returning the raw response (compact projection skipped).',
    );
    return nav;
  }
  return { navigation: parsed.data.navigation.map(compactNavNode) };
}

export function registerDetailTools(server: McpServer, client: GrouponClient): void {
  server.registerTool(
    'groupon_get_deal',
    {
      description:
        'Fetch a single Groupon deal by its permalink slug (or full deal URL). Returns full detail by default; ' +
        'set compact=true for a slim view (title, subtitle, merchant, price, rating, division, option summaries, url).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        dealId: z
          .string()
          .trim()
          .min(1)
          .describe(
            'Deal permalink slug (e.g. "enset-productions-and-ventures-3") OR a full Groupon deal URL — the last path segment is used.',
          ),
        optionId: z.string().optional().describe('Optional deal option id to focus on.'),
        compact: z
          .boolean()
          .default(false)
          .describe('Return a slim projection instead of the full deal.'),
      },
    },
    async (args) => {
      const dealId = stripDealId(args.dealId);
      const deal = await client.getDeal({ dealId, optionId: args.optionId });
      return textResult(args.compact ? compactDeal(deal) : deal);
    },
  );

  server.registerTool(
    'groupon_list_categories',
    {
      description:
        "Fetch Groupon's category taxonomy tree. Set compact=true for a slim {title, url, children} tree.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        compact: z
          .boolean()
          .default(false)
          .describe('Return a slim {title, url, children} tree instead of the full taxonomy payload.'),
      },
    },
    async (args) => {
      const nav = await client.getMainNavigation();
      return textResult(args.compact ? compactNavigation(nav) : nav);
    },
  );
}
