import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { client } from '../../src/client.js';
import { registerUtilityTools } from '../../src/tools/utilities.js';
import { createTestHarness } from '../helpers.js';

const mockRequest = vi.spyOn(client, 'request').mockResolvedValue(undefined as never);
let harness: Awaited<ReturnType<typeof createTestHarness>>;

beforeEach(() => mockRequest.mockClear());
afterAll(async () => {
  if (harness) await harness.close();
});

function parse(result: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(result.content[0].text);
}

describe('utility tools', () => {
  it('setup', async () => {
    harness = await createTestHarness((server) => registerUtilityTools(server, client));
  });

  it('setlist_healthcheck reports ok with a country count on success', async () => {
    mockRequest.mockResolvedValue({ total: 250, country: [] });
    const result = await harness.callTool('setlist_healthcheck', {});
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/search/countries');
    const body = parse(result as never);
    expect(body.ok).toBe(true);
    expect(body.authenticated).toBe(true);
    expect(body.country_count).toBe(250);
  });

  it('setlist_healthcheck reports a no-key hint when the key is missing', async () => {
    // Reject lazily (per-call) rather than via the eager `mockRejectedValue`:
    // with a `beforeEach(mockClear)` in play, vitest's settled-result tracking
    // for an eagerly-created rejected promise gets orphaned and the rejection
    // is mis-reported as unhandled. `mockImplementationOnce(() => reject)`
    // creates the promise only when the handler calls (and awaits) it.
    mockRequest.mockImplementationOnce(() =>
      Promise.reject(new Error('SETLIST_API_KEY environment variable is required')),
    );
    const result = await harness.callTool('setlist_healthcheck', {});
    const body = parse(result as never);
    expect(body.ok).toBe(false);
    expect(body.authenticated).toBe(false);
    expect(String(body.hint)).toMatch(/Set SETLIST_API_KEY/);
  });

  it('setlist_healthcheck reports a bad-key hint on a 403', async () => {
    mockRequest.mockImplementationOnce(() =>
      Promise.reject(new Error('setlist.fm API error 403 GET /1.0/search/countries')),
    );
    const result = await harness.callTool('setlist_healthcheck', {});
    const body = parse(result as never);
    expect(body.ok).toBe(false);
    expect(String(body.hint)).toMatch(/rejected/);
  });
});
