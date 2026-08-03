import {
  readEnvVar,
  parseRetryAfterMs,
  formatApiError,
  McpToolError,
} from '@chrischall/mcp-utils';
import {
  buildGetCart,
  buildCreateOrUpdateCartItem,
  buildDeleteCartItem,
  type CreateOrUpdateCartItemArgs,
  type DeleteCartItemArgs,
  type PersistedQueryOp,
} from './graphql-ops.js';

// Groupon's consumer GraphQL endpoint — the SAME host the anonymous reads use,
// but the cart ops require the user's authenticated SESSION COOKIE. Verified
// 2026-07-25: the cookie ALONE authorizes cart ops (no CSRF header, no
// x-sig-fraud-check), so the write client sends only Cookie + content-type +
// apollographql-client-name + x-operation-name.
const DEFAULT_ENDPOINT = 'https://www.groupon.com/mobilenextapi/graphql';
const SERVICE = 'Groupon cart';
const CLIENT_NAME = 'mobilenextapi';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRY_AFTER_MS = 30_000;

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
        'Open or refresh a signed-in groupon.com tab in the browser running the fetchproxy/Transporter extension, then re-pair the bridge and retry. ' +
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
   * Test/override seam: a pre-resolved session cookie. When set (or when
   * GROUPON_SESSION_COOKIE is present) `requireCookie()` never imports the
   * fetchproxy bridge.
   */
  cookie?: string;
}

/**
 * Authenticated client for Groupon's CART operations. Kept entirely separate
 * from the anonymous read `GrouponClient` (client.ts) so the read tools — and
 * the Cloudflare Worker connector, which imports only client.ts — never pull in
 * the cookie-bootstrap / fetchproxy auth tree.
 *
 * Auth resolves in order: `GROUPON_SESSION_COOKIE` (env, read at construction) →
 * a fetchproxy `capture_request_header` bootstrap of the `Cookie` header from
 * the signed-in browser tab (LAZY-imported so the env path never loads the
 * bridge, and the .mcpb bundle / Worker never eager-load `@fetchproxy/*`) → a
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
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: GrouponWebClientOptions = {}) {
    this.cookie = opts.cookie ?? readEnvVar('GROUPON_SESSION_COOKIE') ?? null;
    this.cookieSource = this.cookie ? 'env' : null;
    this.endpoint = (opts.endpoint ?? readEnvVar('GROUPON_GRAPHQL_URL') ?? DEFAULT_ENDPOINT).replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
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
    const { resolveSessionCookie } = await import('./fetchproxy-cookie.js');
    const { cookieHeader } = await resolveSessionCookie();
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
    const batch = await this.request<GetCartResponse[]>(buildGetCart(), 'GetCart');
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
    );
    return (batch?.[0]?.data ?? {}) as Cart;
  }

  /** Remove a line item from the user's cart by its optionId. Returns the
   *  mutation payload. Callers should RE-READ getCart to verify. */
  async deleteCartItem(args: DeleteCartItemArgs): Promise<Cart> {
    const batch = await this.request<CartMutationResponse[]>(buildDeleteCartItem(args), 'deleteCartItem');
    return (batch?.[0]?.data ?? {}) as Cart;
  }

  /**
   * POST a single-op batched persisted-query array to the GraphQL endpoint with
   * the session cookie + minimal headers. Retries once on 429/503 honoring
   * Retry-After, maps 401/403 to {@link SessionExpiredError}, detects a stale
   * persisted hash, and refuses to blind-parse a non-JSON 2xx body.
   */
  private async request<T>(op: PersistedQueryOp, operationName: string): Promise<T> {
    const buildInit = (cookie: string): RequestInit => ({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'apollographql-client-name': CLIENT_NAME,
        'x-operation-name': operationName,
        Cookie: cookie,
      },
      body: JSON.stringify([op]),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    let init = buildInit(await this.requireCookie());
    let res = await this.fetchImpl(this.endpoint, init);

    // A logged-out / expired session. When the cookie came from the browser it
    // is worth exactly one re-lift per request: the tab usually still holds a
    // live session, and the copy we cached is only stale because we cached it.
    // Env cookies are static, so they fail fast instead.
    //
    // Shared by BOTH 401 checks — the initial response and the post-Retry-After
    // one. Handling only the first meant an expiry that happened to surface
    // after a 429 bypassed the re-lift and wedged the client exactly as before.
    let relifted = false;
    const settleAuthFailure = async (current: Response): Promise<Response> => {
      if (relifted || !this.invalidateLiftedCookie()) throw new SessionExpiredError();
      relifted = true;
      init = buildInit(await this.requireCookie());
      const replayed = await this.fetchImpl(this.endpoint, init);
      if (replayed.status === 401 || replayed.status === 403) {
        // The re-lifted cookie is dead too — the user is signed out in the
        // browser. Drop it on the way out so the NEXT call re-reads the tab
        // instead of inheriting a value we already know is dead; otherwise
        // "sign back in and retry" would still be a lie.
        this.invalidateLiftedCookie();
        throw new SessionExpiredError();
      }
      void current;
      return replayed;
    };

    if (res.status === 401 || res.status === 403) {
      res = await settleAuthFailure(res);
    }
    // Honor Retry-After once on throttling / transient unavailability.
    if (res.status === 429 || res.status === 503) {
      const delayMs = parseRetryAfterMs(res.headers.get('retry-after'), {
        defaultMs: 1000,
        capMs: MAX_RETRY_AFTER_MS,
      });
      await this.sleep(delayMs);
      res = await this.fetchImpl(this.endpoint, init);
      if (res.status === 401 || res.status === 403) {
        res = await settleAuthFailure(res);
      }
    }

    const text = await res.text();
    if (res.status === 429 || res.status === 503) {
      throw new McpToolError(`${SERVICE} rate limit: still receiving ${res.status} after a retry.`, {
        hint: 'Space out cart operations and retry shortly.',
      });
    }
    if (!res.ok) {
      throw new McpToolError(formatApiError(res.status, 'POST', this.endpoint, text, { service: SERVICE }), {
        hint: 'Groupon masks GraphQL errors as opaque 400 HTML. If this started suddenly, the persisted-query hash in graphql-ops.ts may need re-capture.',
      });
    }

    // A 2xx that isn't JSON is a bot/challenge interstitial — never JSON.parse blind.
    let parsed: unknown;
    try {
      parsed = text.trim() ? JSON.parse(text) : undefined;
    } catch {
      throw new McpToolError(
        `${SERVICE} returned a non-JSON ${res.status} response (likely a bot/challenge interstitial).`,
        {
          hint: 'Groupon may be rate-limiting or challenging this client. Retry shortly; if it persists, the request may need to originate from a different network.',
        },
      );
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
 * Module-level singleton shared by the cart tool module. Deferred-config: the
 * missing-session error surfaces on the first cart call, never at construction —
 * so the stdio server still boots and lists tools with no credential.
 */
export const webClient = new GrouponWebClient();
