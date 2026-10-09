import { readEnvVar, ApiError, EdgeBlockedError, McpToolError } from '@chrischall/mcp-utils';
import {
  buildGetCart,
  buildCreateOrUpdateCartItem,
  buildDeleteCartItem,
  type CreateOrUpdateCartItemArgs,
  type DeleteCartItemArgs,
  type PersistedQueryOp,
} from './graphql-ops.js';
import {
  createGrouponTransport,
  mapTransportError,
  GrouponAuthRejected,
  type GrouponTransport,
} from './transport.js';

// Groupon's consumer GraphQL endpoint — the SAME host the anonymous reads use,
// but the cart ops require the user's authenticated SESSION COOKIE. Verified
// 2026-07-25: the cookie ALONE authorizes cart ops (no CSRF header, no
// x-sig-fraud-check), so the write client sends only Cookie + content-type +
// apollographql-client-name + x-operation-name.
const DEFAULT_ENDPOINT = 'https://www.groupon.com/mobilenextapi/graphql';
const SERVICE = 'Groupon cart';
const RATE_LIMIT_HINT = 'Space out cart operations and retry shortly.';
const HTTP_HINT =
  'Groupon masks GraphQL errors as opaque 400 HTML. If this started suddenly, the persisted-query hash in graphql-ops.ts may need re-capture.';
// GetCart is a read: retry throttling (429) and transient unavailability (503).
const READ_RETRY_STATUSES = [429, 503];
// Cart MUTATIONS retry only 429, which is guaranteed not processed. A 503 from
// a gateway can arrive after Groupon already applied the change, so replaying
// createOrUpdateCartItem could double an add (fleet-audit #483).
const MUTATION_RETRY_STATUSES = [429];

/**
 * The Groupon session is missing or expired. Distinct from a generic upstream
 * error so the cart tools can surface a stable "re-authenticate" remediation
 * rather than a transient-failure hint. Raised on a 401/403 or a logged-out
 * `GetCart` shape.
 */
export class SessionExpiredError extends McpToolError {
  constructor() {
    super('Your Groupon session is missing or expired — cart operations require a signed-in session.', {
      hint:
        'Open or refresh a signed-in groupon.com tab in the browser running the ContextMint Bridge extension, then re-pair the bridge and retry. ' +
        'Alternatively set GROUPON_SESSION_COOKIE to a fresh session cookie for local dev.',
    });
  }
}

/** Loosely-typed cart payload. The cart tools own field-level projection. */
export interface Cart {
  [k: string]: unknown;
}

export interface GrouponWebClientOptions {
  /** GraphQL endpoint; default GROUPON_GRAPHQL_URL or the production host. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Test/override seam: the browser-cookie lift.
   *
   * The default lazily imports `fetchproxy-cookie.ts` INSIDE the call, so the
   * env path still never pulls `@fetchproxy/*` into the eager module graph —
   * that laziness is the reason the import lives where it does and must
   * survive this seam.
   *
   * It exists because the alternative for tests was `vi.doMock` on that module,
   * and this class is imported STATICALLY by the suite: `vi.resetModules()`
   * cannot rebind an already-bound import, so whether the dynamic import saw
   * the mock depended on registry state at call time. That made the
   * expired-session tests flaky in CI — `expected 3 calls, got 0` when the real
   * resolver ran instead of the spy — while passing locally every time.
   */
  resolveCookie?: () => Promise<{ cookieHeader: string }>;
  /**
   * Test/override seam: a pre-resolved session cookie. When set (or when
   * GROUPON_SESSION_COOKIE is present) `requireCookie()` never imports the
   * fetchproxy bridge.
   */
  cookie?: string;
}

/**
 * Authenticated client for Groupon's CART operations. Kept entirely separate
 * from the anonymous read `GrouponClient` (client.ts) so the read tools — and
 * a read-only deployment, which imports only client.ts — never pull in
 * the cookie-bootstrap / fetchproxy auth tree.
 *
 * Auth resolves in order: `GROUPON_SESSION_COOKIE` (env, read at construction) →
 * a fetchproxy `capture_request_header` bootstrap of the `Cookie` header from
 * the signed-in browser tab (LAZY-imported so the env path never loads the
 * bridge, and the .mcpb bundle never eager-loads `@fetchproxy/*`) → a
 * deferred config error at the first cart call. Deferred-config: reads still
 * boot with no creds; the missing-session error surfaces only here.
 */
export class GrouponWebClient {
  private cookie: string | null;
  /**
   * Where `cookie` came from. Only a browser-lifted cookie can be renewed —
   * an env-supplied `GROUPON_SESSION_COOKIE` is static, so re-lifting on its
   * behalf would burn a bridge round-trip to produce the same dead value.
   */
  private cookieSource: 'env' | 'lift' | null;
  private readonly readTransport: GrouponTransport;
  private readonly mutationTransport: GrouponTransport;
  private readonly resolveCookie: () => Promise<{ cookieHeader: string }>;
  /** Set when the endpoint is not a groupon.com https URL: every cart call
   *  throws it, so the session cookie is never lifted or sent elsewhere. */
  private readonly endpointError: McpToolError | null;

  constructor(opts: GrouponWebClientOptions = {}) {
    this.cookie = opts.cookie ?? readEnvVar('GROUPON_SESSION_COOKIE') ?? null;
    this.cookieSource = this.cookie ? 'env' : null;
    const endpoint = (opts.endpoint ?? readEnvVar('GROUPON_GRAPHQL_URL') ?? DEFAULT_ENDPOINT).replace(/\/+$/, '');
    this.endpointError = cookieEndpointError(endpoint);
    const fetchImpl = opts.fetchImpl ?? fetch;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const transport = (retryStatuses: number[]) =>
      createGrouponTransport({ endpoint, service: SERVICE, fetchImpl, sleep, retryStatuses, rateLimitHint: RATE_LIMIT_HINT });
    this.readTransport = transport(READ_RETRY_STATUSES);
    this.mutationTransport = transport(MUTATION_RETRY_STATUSES);
    this.resolveCookie =
      opts.resolveCookie ??
      (async () => {
        // Imported here, not at module scope: the env path must not load the
        // bridge (see the seam's docblock).
        const { resolveSessionCookie } = await import('./fetchproxy-cookie.js');
        return resolveSessionCookie();
      });
  }

  /**
   * Resolve the session cookie: `GROUPON_SESSION_COOKIE` (env, read at
   * construction) first, else the shared three-path resolver in
   * fetchproxy-cookie.ts — a one-time fetchproxy `Cookie`-header grab from the
   * signed-in tab (lazy-imported so the env path never loads the bridge, keeping
   * `@fetchproxy/*` out of the eager module graph). The resolver throws an
   * actionable, deferred config error when nothing is configured.
   *
   * The resolved cookie is cached on the instance, but a browser-lifted one is
   * dropped by {@link invalidateLiftedCookie} on a 401/403 so the next call
   * re-reads the tab — it is cached until it stops working, not for the life
   * of the process. An env-supplied cookie is static and never re-resolved.
   */
  private async requireCookie(): Promise<string> {
    if (this.cookie) return this.cookie;
    const { cookieHeader } = await this.resolveCookie();
    this.cookie = cookieHeader;
    this.cookieSource = 'lift';
    return cookieHeader;
  }

  /**
   * Drop a lifted cookie so the next `requireCookie()` re-reads the browser.
   *
   * Without this the cached cookie outlived the session it represented: the
   * first expiry wedged the client for the life of the process, since every
   * later call replayed the same dead value. Returns false when there is
   * nothing worth re-lifting (env-supplied or never resolved), so callers can
   * skip a pointless retry.
   */
  private invalidateLiftedCookie(): boolean {
    if (this.cookieSource !== 'lift') return false;
    this.cookie = null;
    this.cookieSource = null;
    return true;
  }

  /** Read the signed-in user's cart. Throws {@link SessionExpiredError} when the
   *  session is logged out (a null `getCart` payload or a 401/403). */
  async getCart(): Promise<Cart> {
    const batch = await this.request<GetCartResponse[]>(buildGetCart(), 'GetCart', 'read');
    const cart = batch?.[0]?.data?.getCart;
    // A logged-out session comes back with a null/absent getCart rather than an
    // empty-but-present cart object — treat that as an expired session.
    if (cart === undefined || cart === null) throw new SessionExpiredError();
    return cart;
  }

  /** Add (or update the quantity of) a deal option in the user's cart. Returns
   *  the mutation payload. Callers should RE-READ getCart to verify. */
  async addToCart(args: CreateOrUpdateCartItemArgs): Promise<Cart> {
    const batch = await this.request<CartMutationResponse[]>(
      buildCreateOrUpdateCartItem(args),
      'createOrUpdateCartItem',
      'mutation',
    );
    return mutationData(batch, 'add to cart');
  }

  /** Remove a line item from the user's cart by its optionId. Returns the
   *  mutation payload. Callers should RE-READ getCart to verify. */
  async deleteCartItem(args: DeleteCartItemArgs): Promise<Cart> {
    const batch = await this.request<CartMutationResponse[]>(
      buildDeleteCartItem(args),
      'deleteCartItem',
      'mutation',
    );
    return mutationData(batch, 'remove from cart');
  }

  /**
   * POST a single-op batched persisted-query array to the GraphQL endpoint with
   * the session cookie + minimal headers, via the shared mcp-utils client: a
   * fresh 30s timeout per attempt and one Retry-After-honouring retry (429/503
   * for the GetCart read, 429 only for a mutation). Maps 401/403 to
   * {@link SessionExpiredError} after at most one browser re-lift, detects a
   * stale persisted hash, and refuses to blind-parse a non-JSON 2xx body.
   */
  private async request<T>(op: PersistedQueryOp, operationName: string, kind: 'read' | 'mutation'): Promise<T> {
    if (this.endpointError) throw this.endpointError;
    const transport = kind === 'read' ? this.readTransport : this.mutationTransport;
    const send = (cookie: string): Promise<unknown> =>
      transport.api.fetchJson('POST', transport.path, {
        body: [op],
        headers: { 'x-operation-name': operationName, Cookie: cookie },
      });

    let parsed: unknown;
    try {
      try {
        parsed = await send(await this.requireCookie());
      } catch (err) {
        if (!isAuthFailure(err)) throw err;
        // A logged-out / expired session. When the cookie came from the
        // browser it is worth exactly one re-lift per request: the tab usually
        // still holds a live session, and the copy we cached is only stale
        // because we cached it. Env cookies are static, so they fail fast.
        //
        // The shared client retries a 429 internally, so a 401 that surfaces
        // AFTER a Retry-After lands here too — one re-lift covers both.
        if (!this.invalidateLiftedCookie()) throw new SessionExpiredError();
        try {
          parsed = await send(await this.requireCookie());
        } catch (replayErr) {
          if (!isAuthFailure(replayErr)) throw replayErr;
          // The re-lifted cookie is dead too — the user is signed out in the
          // browser. Drop it on the way out so the NEXT call re-reads the tab
          // instead of inheriting a value we already know is dead.
          this.invalidateLiftedCookie();
          throw new SessionExpiredError();
        }
      }
    } catch (err) {
      throw mapTransportError(err, {
        service: SERVICE,
        retryStatuses: transport === this.readTransport ? READ_RETRY_STATUSES : MUTATION_RETRY_STATUSES,
        rateLimitHint: RATE_LIMIT_HINT,
        httpHint: HTTP_HINT,
        unretried503: () =>
          new McpToolError(
            `${SERVICE} was unavailable (503) for ${operationName}; the request was not retried because Groupon may already have applied it.`,
            { hint: 'Check groupon_view_cart to see whether the change landed before retrying.' },
          ),
      });
    }

    this.assertNoPersistedQueryError(parsed);
    return parsed as T;
  }

  /**
   * Surface a stale persisted-query hash (`PersistedQueryNotFound`) — top-level
   * or inside a batched element — as an actionable error rather than a missing
   * `data`.
   */
  private assertNoPersistedQueryError(parsed: unknown): void {
    const elements = Array.isArray(parsed) ? parsed : [parsed];
    for (const el of elements) {
      const errors = (el as { errors?: Array<{ message?: string }> } | null)?.errors;
      if (Array.isArray(errors) && errors.some((e) => e?.message === 'PersistedQueryNotFound')) {
        throw new McpToolError(
          'A Groupon cart persisted query is stale; the sha256Hash in graphql-ops.ts must be re-captured.',
          {
            hint: 'Groupon redeployed its GraphQL schema. Re-capture the cart op hashes (GetCart / createOrUpdateCartItem / deleteCartItem) from a live signed-in groupon.com cart request and update them in src/graphql-ops.ts.',
          },
        );
      }
    }
  }
}

/**
 * The cart client sends the user's full groupon.com session cookie, so it only
 * talks to groupon.com (or a subdomain) over https. A `GROUPON_GRAPHQL_URL`
 * pointing anywhere else — a typo, a stale local override, a poisoned .env —
 * would hand that session to another host (fleet-audit #489). Returns the
 * error to raise on every cart call, or null for a safe endpoint.
 */
function cookieEndpointError(endpoint: string): McpToolError | null {
  const url = URL.canParse(endpoint) ? new URL(endpoint) : undefined;
  const host = url?.hostname.toLowerCase();
  if (url?.protocol === 'https:' && host && (host === 'groupon.com' || host.endsWith('.groupon.com'))) {
    return null;
  }
  return new McpToolError(
    `The Groupon cart endpoint "${endpoint}" (GROUPON_GRAPHQL_URL) is not a groupon.com https URL, so the cart tools will not send your session cookie to it.`,
    {
      hint: 'Unset GROUPON_GRAPHQL_URL (or point it at an https://*.groupon.com URL) and restart the server.',
    },
  );
}

/**
 * A 401 (the transport's `onUnauthorized`) or a 403 — Groupon's two ways of
 * refusing a dead session cookie. A CDN/WAF refusal page is NOT one: the
 * shared client throws it as an `EdgeBlockedError`, which passes through as
 * itself without a re-lift.
 */
function isAuthFailure(err: unknown): boolean {
  // A CDN/WAF refusal page (chrischall/mcp-host#1015) answers 401/403 too, but
  // the session was never judged: re-lifting would spend the browser's cookie
  // for nothing, and reporting it as expired sends the user to sign in again.
  if (err instanceof EdgeBlockedError) return false;
  return err instanceof GrouponAuthRejected || (err instanceof ApiError && (err.status === 401 || err.status === 403));
}

/** Shape of one batched-response element for a GetCart op. */
interface GetCartResponse {
  data?: { getCart?: Cart | null };
  errors?: Array<{ message?: string }>;
}

/** Shape of one batched-response element for a cart mutation op. */
interface CartMutationResponse {
  data?: Cart;
  errors?: Array<{ message?: string }>;
}

/**
 * Unwrap a cart mutation's batched response, refusing anything but a clean
 * success. Groupon rejects a cart change it will not make (a quantity cap, a
 * sold-out option, a per-customer limit) with HTTP 200 and a GraphQL `errors`
 * array; returning `data ?? {}` turned that rejection into an apparent success
 * that the purchase tool then reported as `added: true`.
 */
function mutationData(batch: CartMutationResponse[] | undefined, action: string): Cart {
  const el = batch?.[0];
  const messages = (Array.isArray(el?.errors) ? el.errors : [])
    .map((e) => (typeof e?.message === 'string' && e.message ? e.message : 'unknown error'));
  if (messages.length > 0) {
    throw new McpToolError(`${SERVICE} rejected the ${action} request: ${messages.join('; ')}.`, {
      hint: 'The rejected change to this item was not applied. Check the option is still available and within any per-customer quantity limit (groupon_view_cart shows what is already in the cart).',
    });
  }
  if (el?.data === undefined || el.data === null) {
    throw new McpToolError(`${SERVICE} returned no result for the ${action} request.`, {
      hint: 'The change may not have been applied. Check groupon_view_cart before retrying.',
    });
  }
  return el.data;
}

/**
 * Module-level singleton shared by the cart tool module. Deferred-config: the
 * missing-session error surfaces on the first cart call, never at construction —
 * so the stdio server still boots and lists tools with no credential.
 */
export const webClient = new GrouponWebClient();
