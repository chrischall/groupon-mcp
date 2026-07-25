// Typed builders for Groupon's consumer GraphQL persisted-query ops.
//
// Groupon's consumer GraphQL endpoint (https://www.groupon.com/mobilenextapi/graphql)
// speaks Apollo Automatic Persisted Queries: instead of sending the full query
// text, each op references a sha256Hash that Groupon pre-registered on its
// servers. Introspection is disabled and the server masks all GraphQL errors as
// opaque 400 HTML, so we DO NOT hand-author queries — we replay Groupon's own
// persisted-query hash captured from the live site.

/**
 * Persisted-query fingerprint for the `BrowseDealFeed` op. This is a PUBLIC
 * sha256 fingerprint of Groupon's own query document (the same value their web
 * client sends on every search) — it is NOT a secret or credential.
 *
 * Captured 2026-07-24 from a live groupon.com search. If Groupon redeploys its
 * GraphQL schema this hash goes stale and the server answers
 * `{ errors: [{ message: 'PersistedQueryNotFound' }] }` — the client surfaces
 * that as an actionable error telling the operator to re-capture this value.
 */
export const BROWSE_DEAL_FEED_HASH =
  'b035b25dceb8a84a64c618345cc21a14897b7328506a39b2e27fc7ca4ec2f429';

/** Arguments for {@link buildBrowseDealFeed}. */
export interface BrowseDealFeedArgs {
  /**
   * Free-text search term (e.g. "massage", "pizza"). When omitted, the `query`
   * filter is left off entirely and Groupon returns a plain category/city
   * browse feed for the division.
   */
  query?: string;
  /** Groupon city/division slug, e.g. "new-york", "syracuse", "chicago". */
  division: string;
  /** Page size. */
  limit: number;
  /** Zero-based offset into the feed for pagination. */
  offset: number;
}

/**
 * One element of the batched Apollo APQ request array. Groupon's endpoint takes
 * a top-level JSON ARRAY of these; a single-op request is an array of length 1.
 */
export interface PersistedQueryOp {
  operationName: string;
  variables: Record<string, unknown>;
  extensions: { persistedQuery: { version: 1; sha256Hash: string } };
}

/**
 * Build the batched-request element for the verified `BrowseDealFeed` op. The
 * `query` filter is included only when a search term is present — omitting it
 * yields a plain category/city browse feed. The returned object is meant to be
 * wrapped in a one-element array before POSTing (Groupon batches ops).
 */
export function buildBrowseDealFeed({ query, division, limit, offset }: BrowseDealFeedArgs): PersistedQueryOp {
  const filters =
    query === undefined
      ? []
      : [{ key: 'query', subKey: null, value: { static: query } }];

  return {
    operationName: 'BrowseDealFeed',
    variables: {
      dealFeedParams: {
        limit,
        division,
        locationFromUrl: false,
        filters,
        offset,
        feedToken: null,
        includeLocationsCount: true,
      },
      browseParams: { pathName: '/search', isFetchMore: false },
      allLocations: false,
    },
    extensions: {
      persistedQuery: { version: 1, sha256Hash: BROWSE_DEAL_FEED_HASH },
    },
  };
}

/**
 * Persisted-query fingerprint for the `getDeal` op — deal detail by permalink
 * slug. This is a PUBLIC sha256 fingerprint of Groupon's own query document (the
 * same value their web client sends), NOT a secret or credential.
 *
 * Captured 2026-07-24 from a live groupon.com deal page. If Groupon redeploys its
 * GraphQL schema this hash goes stale and the server answers
 * `{ errors: [{ message: 'PersistedQueryNotFound' }] }` — the client surfaces
 * that as an actionable error telling the operator to re-capture this value.
 */
export const GET_DEAL_HASH =
  'd60360371251da4c5ce1f753d3e55a77e80d538c6c57fd4fc20dc894cd121236';

/**
 * Persisted-query fingerprint for the `GetMainNavigation` op — category
 * taxonomy tree. This is a PUBLIC sha256 fingerprint of Groupon's own query
 * document (the same value their web client sends), NOT a secret or credential.
 *
 * Captured 2026-07-24 from a live groupon.com page. If Groupon redeploys its
 * GraphQL schema this hash goes stale and the server answers
 * `{ errors: [{ message: 'PersistedQueryNotFound' }] }` — the client surfaces
 * that as an actionable error telling the operator to re-capture this value.
 */
export const MAIN_NAVIGATION_HASH =
  'da722d6e5ae1b4e336bbda8d2d07f31925aa709acf9843c67c5a65d0827aeb01';

/** Arguments for {@link buildGetDeal}. */
export interface GetDealArgs {
  /**
   * The deal permalink slug = last path segment of a card's `url`
   * (`https://www.groupon.com/deals/<dealId>`).
   */
  dealId: string;
  /** Optional deal option id to focus; `null` when omitted. */
  optionId?: string;
}

/**
 * Build the batched-request element for the verified `getDeal` op. The returned
 * object is meant to be wrapped in a one-element array before POSTing (Groupon
 * batches ops). Works even though the `/deals/<slug>` PAGE 403s server-side.
 */
export function buildGetDeal({ dealId, optionId }: GetDealArgs): PersistedQueryOp {
  return {
    operationName: 'getDeal',
    variables: {
      dealId,
      optionId: optionId ?? null,
      adSafe: false,
      includeGeoBreadcrumbs: true,
      useFinePrintV3: true,
    },
    extensions: {
      persistedQuery: { version: 1, sha256Hash: GET_DEAL_HASH },
    },
  };
}

/**
 * Build the batched-request element for the verified `GetMainNavigation` op —
 * the category taxonomy tree. The returned object is meant to be wrapped in a
 * one-element array before POSTing (Groupon batches ops).
 */
export function buildMainNavigation(): PersistedQueryOp {
  return {
    operationName: 'GetMainNavigation',
    variables: {
      includeChildren: true,
      maxDepthLevel: 3,
    },
    extensions: {
      persistedQuery: { version: 1, sha256Hash: MAIN_NAVIGATION_HASH },
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Cart (write-path) persisted-query ops.
//
// These hit the SAME endpoint as the reads, but require the user's
// AUTHENTICATED SESSION COOKIE (no CSRF header, no x-sig-fraud-check — the
// cookie alone, verified 2026-07-25). Each op is still persisted-query-only:
// the hashes are PUBLIC fingerprints of Groupon's own mutations, NOT
// credentials. They can go stale on a Groupon frontend redeploy (→
// PersistedQueryNotFound), same recovery as the read hashes.
//
// There is NO replayable place-order mutation: checkout is native Apple/Google
// Pay/card/PayPal SDK hand-off. The write path ends at "added to cart" and the
// user completes payment at https://www.groupon.com/checkout/cart themselves.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Persisted-query fingerprint for the `GetCart` op — read the signed-in user's
 * cart. PUBLIC fingerprint (not a secret). Captured 2026-07-25.
 * Response: `element[0].data.getCart`.
 */
export const GET_CART_HASH =
  '1471251c7f45dfecdc4625c22e1422f877140e6648e0662d0834b3a92553b45b';

/**
 * Persisted-query fingerprint for the `createOrUpdateCartItem` mutation — ADD or
 * update a cart line item. PUBLIC fingerprint (not a secret). Captured 2026-07-25.
 */
export const CREATE_OR_UPDATE_CART_ITEM_HASH =
  'd0aeb632be4f1316c0b83c5b0d1fe556363f9e149ce7fd590728bfe4d41b782d';

/**
 * Persisted-query fingerprint for the `deleteCartItem` mutation — REMOVE a cart
 * line item by its optionId. PUBLIC fingerprint (not a secret). Captured 2026-07-25.
 */
export const DELETE_CART_ITEM_HASH =
  '914b02bbaaaef8523256314f64b6939a55635e7757a350646ea788fdcde8326a';

/**
 * Build the batched-request element for the `GetCart` op. Takes no variables;
 * the cart is scoped to the session cookie carried on the request.
 */
export function buildGetCart(): PersistedQueryOp {
  return {
    operationName: 'GetCart',
    variables: {},
    extensions: {
      persistedQuery: { version: 1, sha256Hash: GET_CART_HASH },
    },
  };
}

/** Arguments for {@link buildCreateOrUpdateCartItem}. */
export interface CreateOrUpdateCartItemArgs {
  /** The deal option's numeric id (deal.options[].id from a getDeal read). */
  optionId: string;
  /** The deal's uuid (deal.uuid from a getDeal read). */
  dealUuid: string;
  /** The deal option's uuid (deal.options[].uuid from a getDeal read). */
  optionUuid: string;
  /** How many to add. */
  quantity: number;
  /** Whether the line is a gift. */
  isGift: boolean;
}

/**
 * Build the batched-request element for the `createOrUpdateCartItem` mutation —
 * add (or update the quantity of) a deal option in the signed-in user's cart.
 * All four ids come from a `getDeal` read. Meant to be wrapped in a one-element
 * array before POSTing.
 */
export function buildCreateOrUpdateCartItem({
  optionId,
  dealUuid,
  optionUuid,
  quantity,
  isGift,
}: CreateOrUpdateCartItemArgs): PersistedQueryOp {
  return {
    operationName: 'createOrUpdateCartItem',
    variables: { optionId, dealUuid, optionUuid, quantity, isGift },
    extensions: {
      persistedQuery: { version: 1, sha256Hash: CREATE_OR_UPDATE_CART_ITEM_HASH },
    },
  };
}

/** Arguments for {@link buildDeleteCartItem}. */
export interface DeleteCartItemArgs {
  /** The optionId of the cart line to remove (from a GetCart read). */
  optionId: string;
}

/**
 * Build the batched-request element for the `deleteCartItem` mutation — remove a
 * line item from the signed-in user's cart by its optionId. Meant to be wrapped
 * in a one-element array before POSTing.
 */
export function buildDeleteCartItem({ optionId }: DeleteCartItemArgs): PersistedQueryOp {
  return {
    operationName: 'deleteCartItem',
    variables: { optionId },
    extensions: {
      persistedQuery: { version: 1, sha256Hash: DELETE_CART_ITEM_HASH },
    },
  };
}
