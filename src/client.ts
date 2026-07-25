import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  loadDotenvSafely,
  readEnvVar,
  createApiClient,
  deepMapStringField,
  dmyToIso,
  type ApiClient,
} from '@chrischall/mcp-utils';
import { augmentSetlists } from './augment.js';

// Load .env for local dev; silently skip if dotenv is unavailable (e.g. the
// mcpb bundle). `loadDotenvSafely` swallows a missing dotenv module and never
// lets .env override a host-provided value.
// The try/catch guards the Cloudflare Worker runtime, where `import.meta.url`
// is undefined and `fileURLToPath(undefined)` would throw at module init
// (Worker startup validation) — there is no filesystem / .env to load there.
try {
  const dir = dirname(fileURLToPath(import.meta.url));
  await loadDotenvSafely({ path: join(dir, '..', '.env'), override: false });
} catch {
  /* non-Node runtime (Workers): no .env to load */
}

const BASE_URL = 'https://api.setlist.fm/rest';
const SERVICE_NAME = 'setlist.fm';
// Bound every request so a slow/hung upstream fails fast (createApiClient throws
// RequestTimeoutError) instead of hanging the tool call. setlist.fm normally
// answers in well under a second.
const REQUEST_TIMEOUT_MS = 15_000;

/** Query params for a GET — undefined/null/empty members are dropped. */
export type Query = Record<string, string | number | undefined>;

export class SetlistClient {
  private readonly apiKey: string | null;
  private readonly configError: Error | null;
  private readonly api: ApiClient;

  /**
   * Defer the config error so the server can still start (and answer the host's
   * install-time tools/list smoke test) when SETLIST_API_KEY isn't set yet.
   * Tool calls re-raise the error at request time via {@link requireKey}.
   *
   * `opts.apiKey` is an optional constructor seam: a hosted, per-user deployment
   * (e.g. the Cloudflare Worker connector) builds one client per request with
   * that user's injected key instead of the process-wide env var. Left unset by
   * the stdio path, which falls back to `SETLIST_API_KEY` exactly as before —
   * keeping that behaviour byte-for-byte identical.
   */
  constructor(opts?: { apiKey?: string }) {
    const key = opts?.apiKey ?? readEnvVar('SETLIST_API_KEY');
    if (!key) {
      this.apiKey = null;
      this.configError = new Error('SETLIST_API_KEY environment variable is required');
    } else {
      this.apiKey = key;
      this.configError = null;
    }

    // setlist.fm authenticates with an `x-api-key` header (not a Bearer token),
    // attached per-request in `request()`. We localize city/country names via an
    // optional `Accept-Language`. `Accept: application/json` is already the
    // fetchJson default (the API serves XML otherwise).
    const lang = readEnvVar('SETLIST_ACCEPT_LANGUAGE');
    this.api = createApiClient({
      baseUrl: BASE_URL,
      serviceName: SERVICE_NAME,
      retry: { count: 1, delayMs: 2000 },
      baseHeaders: lang ? { 'Accept-Language': lang } : undefined,
      timeout: REQUEST_TIMEOUT_MS,
    });
  }

  private requireKey(): string {
    if (this.configError) throw this.configError;
    return this.apiKey!;
  }

  /**
   * Issue a request with the `x-api-key` header attached. `requireKey()` runs
   * here (not in the constructor) so a missing key surfaces at request time,
   * keeping the deferred-config-error pattern intact.
   */
  async request<T>(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown } = {},
  ): Promise<T> {
    const apiKey = this.requireKey();
    const data = await this.api.fetchJson<T>(method, path, {
      headers: { 'x-api-key': apiKey },
      ...(opts.query !== undefined ? { query: opts.query } : {}),
      ...(opts.body !== undefined ? { body: opts.body } : {}),
    });
    // Surface every date as ISO yyyy-MM-dd (the API returns eventDate as dd-MM-yyyy),
    // and annotate setlists with songCount/setCount/hasSongs so stubs are visible.
    return augmentSetlists(deepMapStringField(data, 'eventDate', dmyToIso));
  }
}

/**
 * Module-level singleton shared by every tool module. Constructing it here (not
 * in `index.ts`) keeps the deferred-config-error pattern: the server boots and
 * answers the host's install-time tools/list smoke test even when the API key
 * is absent — the error only surfaces on the first request.
 */
export const client = new SetlistClient();
