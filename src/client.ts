import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadDotenvSafely,
  readEnvVar,
  readTtlMsEnv,
  createResponseCache,
  parseRetryAfterMs,
  formatApiError,
  McpToolError,
  type ResponseCache,
} from '@chrischall/mcp-utils';
import {
  buildBrowseDealFeed,
  buildGetDeal,
  buildMainNavigation,
  type BrowseDealFeedArgs,
  type GetDealArgs,
} from './graphql-ops.js';

// Load .env for local dev; silently skip if dotenv is unavailable (e.g. the
// .mcpb bundle). loadDotenvSafely never lets .env override a host-provided value.
//
// Wrapped in try/catch because a non-Node runtime may reach this module. There
// `import.meta.url` is undefined, so `fileURLToPath(import.meta.url)` throws at
// module-eval time — which would crash startup before any request runs.
// Deal reads need no config, so swallowing the failure is correct everywhere.
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  await loadDotenvSafely({ path: join(__dirname, '..', '.env'), override: false });
} catch {
  // No filesystem/.env in this environment (e.g. a bundle): reads are
  // unauthenticated, so there is nothing to load.
}

// Groupon's consumer GraphQL endpoint. Deal reads reach it from a plain
// server-side fetch with NO cookies / NO auth / NO bot wall — the two headers
// below are all it wants.
const DEFAULT_ENDPOINT = 'https://www.groupon.com/mobilenextapi/graphql';
const SERVICE = 'Groupon GraphQL';
// Groupon's web client identifies itself with this Apollo client-name header;
// the endpoint expects it alongside a JSON content type.
const CLIENT_NAME = 'mobilenextapi';
// Deal feeds return in a couple of seconds; 30s leaves slack without hanging a host.
const REQUEST_TIMEOUT_MS = 30_000;
// Deal listings change slowly relative to a single agent session; a short-TTL
// response cache absorbs an agent re-issuing the same browse/search. Override
// with GROUPON_CACHE_TTL (seconds; 0 = off).
const DEFAULT_CACHE_TTL_MS = 60_000;
// Honor Retry-After on 429/503, but never sleep absurdly long inside a tool call.
const MAX_RETRY_AFTER_MS = 30_000;

/** Response shape we read out of a `BrowseDealFeed` op. Loosely typed — the
 *  tools that project deal cards own the field-level validation. */
export interface BrowseDealFeed {
  cards?: unknown[];
  facets?: unknown[];
  pagination?: unknown;
  browseProps?: unknown;
  [k: string]: unknown;
}

/** Response shape we read out of a `getDeal` op. Loosely typed — the tools that
 *  project the deal own the field-level validation. */
export interface GetDeal {
  title?: unknown;
  subtitle?: unknown;
  options?: unknown;
  price?: unknown;
  merchant?: unknown;
  division?: unknown;
  [k: string]: unknown;
}

/** Response shape we read out of a `GetMainNavigation` op — the category
 *  taxonomy payload. Loosely typed — the tools own the field-level validation. */
export interface MainNavigation {
  [k: string]: unknown;
}

export interface GrouponClientOptions {
  /** GraphQL endpoint; default GROUPON_GRAPHQL_URL or the production host. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class GrouponClient {
  private readonly endpoint: string;
  private readonly configError: Error | null;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly cache: ResponseCache;

  /**
   * Deal reads need no credential, so `configError` stays null and the server
   * always boots. The requireReadable() gate is kept as the seam where a future
   * write path (purchase / connector) would raise a deferred config error — same
   * shape the rest of the fleet uses for keyed clients, so the pattern is ready
   * when the write creds land.
   */
  constructor(opts: GrouponClientOptions = {}) {
    const now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const cacheTtlMs = opts.cacheTtlMs ?? readTtlMsEnv('GROUPON_CACHE_TTL', DEFAULT_CACHE_TTL_MS);
    this.cache = createResponseCache({ ttlMs: { dynamic: cacheTtlMs }, now });
    this.endpoint = (opts.endpoint ?? readEnvVar('GROUPON_GRAPHQL_URL') ?? DEFAULT_ENDPOINT).replace(/\/+$/, '');
    // Reads are unauthenticated: no config error to defer.
    this.configError = null;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Gate kept for the future write path; a no-op for the read-only MVP. */
  private requireReadable(): void {
    if (this.configError) throw this.configError;
  }

  /**
   * Search or browse Groupon deals for a division. Omit `query` for a plain
   * category/city browse. Returns `data.browseDealFeed` from the first (and
   * only) element of Groupon's batched response.
   */
  async browseDealFeed(args: BrowseDealFeedArgs): Promise<BrowseDealFeed> {
    const op = buildBrowseDealFeed(args);
    const cacheKey = `browseDealFeed ${JSON.stringify(args)}`;
    const load = async (): Promise<BrowseDealFeed> => {
      const batch = await this.request<BrowseDealFeedResponse[]>([op]);
      const feed = batch?.[0]?.data?.browseDealFeed;
      if (!feed) {
        throw new McpToolError(`${SERVICE} returned no deal feed for this request.`, {
          hint: 'Check the division slug (e.g. "new-york", "chicago") and try again. If this persists, Groupon may have changed its response shape.',
        });
      }
      return feed;
    };
    return this.cache.fetchThrough(cacheKey, load, 'dynamic') as Promise<BrowseDealFeed>;
  }

  /**
   * Fetch a single deal's detail by permalink slug. Works even though the
   * `/deals/<slug>` PAGE 403s server-side. Returns `data.getDeal` from the first
   * (and only) element of Groupon's batched response.
   */
  async getDeal(args: GetDealArgs): Promise<GetDeal> {
    const op = buildGetDeal(args);
    const cacheKey = `getDeal ${JSON.stringify(args)}`;
    const load = async (): Promise<GetDeal> => {
      const batch = await this.request<GetDealResponse[]>([op]);
      const deal = batch?.[0]?.data?.getDeal;
      if (!deal) {
        throw new McpToolError(`${SERVICE} returned no deal for this request.`, {
          hint: 'Check the dealId slug (the last path segment of a deal URL, e.g. "enset-productions-and-ventures-3"). If this persists, Groupon may have changed its response shape.',
        });
      }
      return deal;
    };
    return this.cache.fetchThrough(cacheKey, load, 'dynamic') as Promise<GetDeal>;
  }

  /**
   * Fetch Groupon's category taxonomy tree. Returns `data` from the first (and
   * only) element of Groupon's batched response.
   */
  async getMainNavigation(): Promise<MainNavigation> {
    const cacheKey = 'getMainNavigation';
    const load = async (): Promise<MainNavigation> => {
      const batch = await this.request<MainNavigationResponse[]>([buildMainNavigation()]);
      const nav = batch?.[0]?.data;
      if (!nav) {
        throw new McpToolError(`${SERVICE} returned no navigation payload.`, {
          hint: 'If this persists, Groupon may have changed its response shape or the persisted-query hash in graphql-ops.ts may need re-capture.',
        });
      }
      return nav;
    };
    return this.cache.fetchThrough(cacheKey, load, 'dynamic') as Promise<MainNavigation>;
  }

  /**
   * POST a batched array of persisted-query ops to the GraphQL endpoint. Retries
   * once on 429/503 honoring Retry-After, detects a stale persisted hash, and
   * refuses to blind-parse a non-JSON 2xx body (a bot/challenge interstitial).
   */
  private async request<T>(batch: unknown[]): Promise<T> {
    this.requireReadable();
    const method = 'POST';
    const init: RequestInit = {
      method,
      headers: {
        'content-type': 'application/json',
        'apollographql-client-name': CLIENT_NAME,
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };

    let res = await this.fetchImpl(this.endpoint, init);
    // Groupon signals throttling / transient unavailability with 429 / 503.
    // Honor Retry-After once, capped so a tool call never sleeps unreasonably long.
    if (res.status === 429 || res.status === 503) {
      const delayMs = parseRetryAfterMs(res.headers.get('retry-after'), {
        defaultMs: 1000,
        capMs: MAX_RETRY_AFTER_MS,
      });
      await this.sleep(delayMs);
      res = await this.fetchImpl(this.endpoint, init);
    }

    const text = await res.text();
    if (res.status === 429 || res.status === 503) {
      throw new McpToolError(`${SERVICE} rate limit: still receiving ${res.status} after a retry.`, {
        hint: 'Space out calls, or rely on the built-in response cache (GROUPON_CACHE_TTL).',
      });
    }
    if (!res.ok) {
      throw new McpToolError(formatApiError(res.status, method, this.endpoint, text, { service: SERVICE }), {
        hint: 'Groupon masks GraphQL errors as opaque 400 HTML. If this started suddenly, the persisted-query hash in graphql-ops.ts may need re-capture.',
      });
    }

    // A 2xx that isn't JSON is a bot/challenge interstitial — never JSON.parse blind.
    let parsed: unknown;
    try {
      parsed = text.trim() ? JSON.parse(text) : undefined;
    } catch {
      throw new McpToolError(`${SERVICE} returned a non-JSON ${res.status} response (likely a bot/challenge interstitial).`, {
        hint: 'Groupon may be rate-limiting or challenging this client. Retry shortly; if it persists, the request may need to originate from a different network.',
      });
    }

    this.assertNoPersistedQueryError(parsed);
    return parsed as T;
  }

  /**
   * A stale persisted-query hash comes back as `{ errors: [{ message:
   * 'PersistedQueryNotFound' }] }` — either as the top-level response or inside a
   * batched element. Surface it as an actionable error rather than letting the
   * caller trip over a missing `data`.
   */
  private assertNoPersistedQueryError(parsed: unknown): void {
    const elements = Array.isArray(parsed) ? parsed : [parsed];
    for (const el of elements) {
      const errors = (el as { errors?: Array<{ message?: string }> } | null)?.errors;
      if (Array.isArray(errors) && errors.some((e) => e?.message === 'PersistedQueryNotFound')) {
        throw new McpToolError(
          'Groupon persisted query is stale; the sha256Hash in graphql-ops.ts must be re-captured.',
          {
            hint: 'Groupon redeployed its GraphQL schema. Re-capture the BrowseDealFeed persisted-query hash from a live groupon.com search (the request body\'s extensions.persistedQuery.sha256Hash) and update BROWSE_DEAL_FEED_HASH in src/graphql-ops.ts.',
          },
        );
      }
    }
  }
}

/** Shape of one batched-response element for a BrowseDealFeed op. */
interface BrowseDealFeedResponse {
  data?: { browseDealFeed?: BrowseDealFeed };
  errors?: Array<{ message?: string }>;
}

/** Shape of one batched-response element for a getDeal op. */
interface GetDealResponse {
  data?: { getDeal?: GetDeal };
  errors?: Array<{ message?: string }>;
}

/** Shape of one batched-response element for a GetMainNavigation op. */
interface MainNavigationResponse {
  data?: MainNavigation;
  errors?: Array<{ message?: string }>;
}

/**
 * Module-level singleton shared by every tool module. Constructed here (not in
 * index.ts) so the server boots and lists tools with no configuration — reads
 * are unauthenticated.
 */
export const client = new GrouponClient();
