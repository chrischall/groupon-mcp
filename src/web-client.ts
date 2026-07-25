import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  loadDotenvSafely,
  readEnvVar,
  createApiClient,
  createThrottle,
  ApiError,
  type ApiClient,
  type Throttle,
} from '@chrischall/mcp-utils';

// Load .env for local dev (guarded; the mcpb bundle omits dotenv).
const __dirname = dirname(fileURLToPath(import.meta.url));
await loadDotenvSafely({ path: join(__dirname, '..', '.env'), override: false });

const RETRY_5XX = 3; // www.setlist.fm intermittently returns 500/502/503 from its gateway
const RETRY_DELAY_MS = 1200;
const RETRYABLE_5XX = [500, 502, 503, 504];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Retry transient gateway errors (500/502/503/504), detected from ApiError's
// real `.status` — never from the message, so a 404 page whose body happens to
// mention "503" doesn't trigger retries. Kept as a local helper (rather than
// the client-level `retry.statuses` option) because the 5xx policy here
// (3 retries × 1.2s) intentionally differs from the client's 429 policy
// (1 retry × 2s), and `RetryPolicy` shares one count/delay across all statuses.
async function retryOn5xx<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_5XX; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_5XX && err instanceof ApiError && RETRYABLE_5XX.includes(err.status)) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

const BASE_URL = 'https://www.setlist.fm';
const SERVICE_NAME = 'setlist.fm (web)';
const REQUEST_TIMEOUT_MS = 20_000;
// Minimum gap between authenticated website requests. A burst of rapid
// authenticated writes appears to get the session throttled/invalidated
// mid-batch (the website is not the ~2 req/sec public API), so every fetch is
// funnelled through a serialized `createThrottle` queue — concurrent calls
// line up and fire one-per-interval instead of racing the pacer and bursting
// together. Injectable now/sleep/paceMs for tests.
const WRITE_PACE_MS = 600;

interface WebClientDeps {
  api?: ApiClient;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  paceMs?: number;
}
// A browser-like UA; the bare default can trip the site's bot heuristics.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/**
 * Authenticated client for the setlist.fm **website** (not the public REST API).
 * The site has no JSON API for user actions — it's server-rendered HTML plus
 * Apache Wicket stateful AJAX, authenticated by the logged-in session cookie.
 *
 * Auth resolves in order: `SETLIST_SESSION_COOKIE` (env) → a fetchproxy
 * `read_cookies` bootstrap from the signed-in browser tab (lazy, optional) →
 * a deferred config error at request time. Kept entirely separate from the
 * api-key `SetlistClient` so the public-API tools never depend on a session.
 */
export class SetlistWebClient {
  private cookie: string | null;
  private readonly api: ApiClient;
  private readonly throttle: Throttle;

  constructor(deps: WebClientDeps = {}) {
    this.cookie = readEnvVar('SETLIST_SESSION_COOKIE') ?? null;
    this.api =
      deps.api ??
      createApiClient({
        baseUrl: BASE_URL,
        serviceName: SERVICE_NAME,
        timeout: REQUEST_TIMEOUT_MS,
        retry: { count: 1, delayMs: 2000 },
        baseHeaders: { 'User-Agent': USER_AGENT },
      });
    // Serialized min-interval scheduler: concurrent calls queue in submission
    // order and each starts >= paceMs after the previous START — unlike a bare
    // lastCallAt check, two concurrent calls can't both read the same
    // timestamp, sleep the same remainder, and fire together. The first call
    // never waits. Mirrors the resolve_concerts pacer.
    this.throttle = createThrottle({
      minIntervalMs: deps.paceMs ?? WRITE_PACE_MS,
      now: deps.now ?? Date.now,
      sleep: deps.sleep ?? sleep,
    });
  }

  /**
   * Resolve the session cookie: `SETLIST_SESSION_COOKIE` (env, read at
   * construction) first, else the shared three-path resolver in
   * fetchproxy-cookie.ts — a one-time fetchproxy `read_cookies` grab from the
   * signed-in tab (lazy-imported so the env path never loads the bridge). The
   * resolver throws an actionable, deferred config error when nothing is
   * configured. The resolved cookie is cached on the instance for the process.
   */
  private async requireCookie(): Promise<string> {
    if (this.cookie) return this.cookie;
    const { resolveSessionCookie } = await import('./fetchproxy-cookie.js');
    const { cookieHeader } = await resolveSessionCookie();
    this.cookie = cookieHeader;
    return cookieHeader;
  }

  /** GET a page as HTML, authenticated. `path` is appended to the www base URL. */
  async fetchPage(path: string): Promise<string> {
    const cookie = await this.requireCookie();
    return this.throttle(() => retryOn5xx(() => this.api.fetchHtml('GET', path, { headers: { Cookie: cookie } })));
  }

  /**
   * Replay an Apache Wicket AJAX behavior GET (e.g. the attendance toggle).
   * `ajaxPath` is the per-render URL parsed from a page's `wicketAjaxGet(...)`;
   * `baseUrl` is the rendering page's path (no leading slash) for the
   * `Wicket-Ajax-BaseURL` header. Returns the `<ajax-response>` XML body.
   */
  async wicketAjaxGet(ajaxPath: string, baseUrl: string): Promise<string> {
    const cookie = await this.requireCookie();
    return this.throttle(() =>
      retryOn5xx(() =>
        this.api.fetchHtml('GET', ajaxPath, {
          headers: {
            Cookie: cookie,
            'Wicket-Ajax': 'true',
            'Wicket-Ajax-BaseURL': baseUrl,
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'text/xml, text/javascript, application/xml, text/html, */*',
          },
        }),
      ),
    );
  }
}

/** Module-level singleton (deferred-config: missing session surfaces at request time). */
export const webClient = new SetlistWebClient();
