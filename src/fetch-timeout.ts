import { McpToolError } from '@chrischall/mcp-utils';

// Groupon responds in a couple of seconds; 30s leaves slack without hanging a host.
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * `fetch` with a per-call {@link REQUEST_TIMEOUT_MS} signal, mapping a timeout
 * (or abort) to an actionable {@link McpToolError} instead of a raw DOMException.
 *
 * The signal is created HERE, per call, on purpose: `AbortSignal.timeout()`
 * starts its clock at creation, so an init built once and reused for a
 * Retry-After retry (after sleeping up to 30s) would abort that retry before it
 * was sent. Shared by the read client and the cart client.
 */
export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: Omit<RequestInit, 'signal'>,
  service: string,
): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    const name = (err as { name?: unknown } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new McpToolError(`${service} request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`, {
        hint: 'Groupon was slow to respond. Retry shortly.',
      });
    }
    throw err;
  }
}
