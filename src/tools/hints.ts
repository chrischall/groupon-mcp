/**
 * Context-group hints, published on each tool as `_meta.mint` (the mcp-host
 * context-groups contract, `mintHintSchema`). Inert data: a host that does not
 * read them sees an extra `_meta` key and nothing else. The shape is fixed by
 * the host's contract, so it is restated here rather than imported — this
 * server takes no dependency on mcp-host.
 *
 * Every tool here is in the `food` group. None is canonical: Groupon's surface
 * is a public deal catalogue plus the signed-in cart, and neither is a dated,
 * per-person feed that answers a "what's new / due / on" ask. Groupon also has
 * no listable set of subjects (children, properties, accounts), so no tool
 * declares `subject`. `aliases` are the words a person says: lowercase, at
 * most 8, each at most 40 chars.
 */
export type MintIntent =
  | 'whats-new' | 'whats-due' | 'whats-on' | 'lookup' | 'turn-on-off' | 'send' | 'change' | 'other';

export interface MintHint {
  domain: 'food';
  intent: MintIntent;
  canonical?: true;
  subject?: string;
  when?: { start: string; end: string };
  aliases?: string[];
}

/** `_meta` for a Groupon tool: every tool here is in the `food` domain. */
export function foodMeta(
  intent: MintIntent,
  extra: Omit<MintHint, 'domain' | 'intent'> = {},
): { mint: MintHint } {
  return { mint: { domain: 'food', intent, ...extra } };
}

/** What people say when they want a deal. */
export const DEAL_ALIASES = ['groupon', 'deals', 'coupons', 'discounts', 'offers', 'vouchers'];
/** What people say about the cart. */
export const CART_ALIASES = ['cart', 'shopping cart', 'basket'];
