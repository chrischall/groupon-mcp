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
