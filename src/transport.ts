import {
  createApiClient,
  ApiError,
  RequestTimeoutError,
  McpToolError,
  type ApiClient,
} from '@chrischall/mcp-utils';

// Groupon responds in a couple of seconds; 30s leaves slack without hanging a host.
export const REQUEST_TIMEOUT_MS = 30_000;
// Honor Retry-After on a retried status, but never sleep absurdly long inside a tool call.
export const MAX_RETRY_AFTER_MS = 30_000;
// Fallback delay when a retried response carries no (parseable) Retry-After.
export const DEFAULT_RETRY_DELAY_MS = 1_000;
// Groupon's web client identifies itself with this Apollo client-name header;
// the endpoint expects it alongside a JSON content type.
export const CLIENT_NAME = 'mobilenextapi';

/**
 * Thrown (via `onUnauthorized`) for a 401, so the cart client can tell an auth
 * refusal apart from every other upstream failure without regexing messages.
 */
export class GrouponAuthRejected extends Error {
  readonly status = 401;
  constructor() {
    super('Groupon rejected the request as unauthorized.');
    this.name = 'GrouponAuthRejected';
  }
}

export interface GrouponTransportOptions {
  /** The full GraphQL endpoint URL (may be overridden by GROUPON_GRAPHQL_URL). */
  endpoint: string;
  /** Human service name for error messages. */
  service: string;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /**
   * Statuses retried once (honoring Retry-After). Reads retry 429 and 503;
   * cart MUTATIONS retry only 429 — a 503 from a gateway can arrive after the
   * upstream already applied the change, so replaying it could double an add.
   */
  retryStatuses: number[];
  /** Hint attached to the "still throttled after a retry" error. */
  rateLimitHint: string;
}

export interface GrouponTransport {
  api: ApiClient;
  /** The endpoint's path (+ query) relative to the client's base origin. */
  path: string;
}

/**
 * Build the shared mcp-utils API client for Groupon's GraphQL endpoint: a fresh
 * {@link REQUEST_TIMEOUT_MS} timeout per attempt (bounding the body read too),
 * one Retry-After-honouring retry on `retryStatuses`, and the Apollo client-name
 * header on every request. Groupon has no bearer token — `getToken` is unset,
 * and the cart client passes its session `Cookie` per request.
 */
export function createGrouponTransport(opts: GrouponTransportOptions): GrouponTransport {
  const url = new URL(opts.endpoint);
  const api = createApiClient({
    baseUrl: url.origin,
    serviceName: opts.service,
    fetchImpl: opts.fetchImpl,
    sleep: opts.sleep,
    timeout: REQUEST_TIMEOUT_MS,
    baseHeaders: { 'apollographql-client-name': CLIENT_NAME },
    retry: {
      count: 1,
      delayMs: DEFAULT_RETRY_DELAY_MS,
      statuses: opts.retryStatuses,
      honorRetryAfter: true,
      maxRetryAfterMs: MAX_RETRY_AFTER_MS,
    },
    onUnauthorized: () => new GrouponAuthRejected(),
    onRateLimited: () =>
      new McpToolError(`${opts.service} rate limit: still receiving 429 after a retry.`, {
        hint: opts.rateLimitHint,
      }),
  });
  return { api, path: `${url.pathname}${url.search}` };
}

export interface MapErrorOptions {
  service: string;
  /** Statuses the transport retried — an exhausted one reads as a rate limit. */
  retryStatuses: number[];
  rateLimitHint: string;
  /** Hint for any other non-2xx (Groupon masks GraphQL errors as opaque 400 HTML). */
  httpHint: string;
  /**
   * Message for a 503 on a request that was deliberately NOT retried (a cart
   * mutation). Unset → the generic HTTP error.
   */
  unretried503?: () => McpToolError;
}

/**
 * Translate a transport failure into the actionable {@link McpToolError}s the
 * Groupon tools have always surfaced. Errors that are already actionable
 * (McpToolError, SessionExpiredError, …) pass through untouched.
 */
export function mapTransportError(err: unknown, opts: MapErrorOptions): unknown {
  if (err instanceof McpToolError) return err;
  if (err instanceof RequestTimeoutError) {
    return new McpToolError(`${opts.service} request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`, {
      hint: 'Groupon was slow to respond. Retry shortly.',
    });
  }
  if (err instanceof SyntaxError) {
    // A 2xx that isn't JSON is a bot/challenge interstitial — never JSON.parse blind.
    return new McpToolError(
      `${opts.service} returned a non-JSON 2xx response (likely a bot/challenge interstitial).`,
      {
        hint: 'Groupon may be rate-limiting or challenging this client. Retry shortly; if it persists, the request may need to originate from a different network.',
      },
    );
  }
  if (err instanceof ApiError) {
    if (opts.retryStatuses.includes(err.status)) {
      return new McpToolError(`${opts.service} rate limit: still receiving ${err.status} after a retry.`, {
        hint: opts.rateLimitHint,
      });
    }
    if (err.status === 503 && opts.unretried503) return opts.unretried503();
    return new McpToolError(err.message, { hint: opts.httpHint });
  }
  return err;
}
