import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SetlistWebClient } from '../src/web-client.js';

// Stub the global fetch (createApiClient binds it at construction → stub first).
interface Call { url: string; init: { headers: Record<string, string> } }

describe('SetlistWebClient', () => {
  let calls: Call[];
  function stubFetch(body = '<html>ok</html>', status = 200): ReturnType<typeof vi.fn> {
    const fn = vi.fn(async (url: string, init: Call['init']) => {
      calls.push({ url, init });
      return new Response(body, { status, headers: { 'content-type': 'text/html' } });
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  }
  beforeEach(() => { calls = []; });
  afterEach(() => {
    vi.unstubAllGlobals();
    // Restore real timers so the 5xx-retry test's vi.useFakeTimers() can't
    // leak fake-timer state into subsequent tests (no-op when not faked).
    vi.useRealTimers();
    delete process.env.SETLIST_SESSION_COOKIE;
    delete process.env.SETLIST_DISABLE_FETCHPROXY;
  });

  it('fetchPage sends the session cookie + browser UA against the www base URL', async () => {
    process.env.SETLIST_SESSION_COOKIE = 'JSESSIONID=abc';
    stubFetch();
    const c = new SetlistWebClient();
    await c.fetchPage('/setlist/x.html');
    expect(calls[0].url).toBe('https://www.setlist.fm/setlist/x.html');
    expect(calls[0].init.headers.Cookie).toBe('JSESSIONID=abc');
    expect(calls[0].init.headers['User-Agent']).toMatch(/Mozilla/);
  });

  it('wicketAjaxGet sends the Wicket-Ajax headers and base URL', async () => {
    process.env.SETLIST_SESSION_COOKIE = 'c=1';
    stubFetch('<ajax-response></ajax-response>');
    const c = new SetlistWebClient();
    await c.wicketAjaxGet('/?p:1-link', 'setlist/x.html');
    expect(calls[0].url).toBe('https://www.setlist.fm/?p:1-link');
    const h = calls[0].init.headers;
    expect(h['Wicket-Ajax']).toBe('true');
    expect(h['Wicket-Ajax-BaseURL']).toBe('setlist/x.html');
    expect(h['X-Requested-With']).toBe('XMLHttpRequest');
    expect(h.Cookie).toBe('c=1');
  });

  it('retries a transient 5xx then succeeds', async () => {
    process.env.SETLIST_SESSION_COOKIE = 'c=1';
    vi.useFakeTimers();
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      n += 1;
      return new Response(n === 1 ? 'gateway' : '<html>ok</html>', {
        status: n === 1 ? 502 : 200,
        headers: { 'content-type': 'text/html' },
      });
    }));
    const c = new SetlistWebClient();
    const p = c.fetchPage('/setlist/x.html');
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toContain('ok');
    expect(n).toBe(2);
  });

  it('does not retry a 404 whose body merely mentions a 5xx code', async () => {
    process.env.SETLIST_SESSION_COOKIE = 'c=1';
    const fn = vi.fn(async () => {
      return new Response('Not found — see /errors/503 for maintenance windows', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      });
    });
    vi.stubGlobal('fetch', fn);
    const c = new SetlistWebClient();
    await expect(c.fetchPage('/setlist/x.html')).rejects.toThrow(/404/);
    expect(fn).toHaveBeenCalledTimes(1); // no retries: a 404 is not transient
  });

  it('paces consecutive authenticated requests at least paceMs apart', async () => {
    process.env.SETLIST_SESSION_COOKIE = 'c=1';
    stubFetch();
    let t = 1_000_000; // start high so the first call (lastCallAt=0) never waits
    const sleeps: number[] = [];
    const c = new SetlistWebClient({
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
      paceMs: 500,
    });
    await c.fetchPage('/a'); // first request runs immediately
    await c.fetchPage('/b'); // second must be gated ~paceMs after the first
    expect(sleeps).toEqual([500]);
    expect(calls.length).toBe(2);
  });

  it('serializes CONCURRENT requests: the second starts >= paceMs after the first', async () => {
    process.env.SETLIST_SESSION_COOKIE = 'c=1';
    let t = 1_000_000; // start high so the first call never waits
    const startTimes: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        startTimes.push(t);
        return new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } });
      }),
    );
    const c = new SetlistWebClient({
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
      paceMs: 500,
    });
    // Fired concurrently (e.g. parallel tool calls) — the pacer must still
    // space the request starts, not let both sleep the same remainder and
    // burst together.
    await Promise.all([c.fetchPage('/a'), c.fetchPage('/b')]);
    expect(startTimes).toHaveLength(2);
    expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(500);
  });

  it('throws a clear config error (no network) when no session is set and the bridge is disabled', async () => {
    delete process.env.SETLIST_SESSION_COOKIE;
    process.env.SETLIST_DISABLE_FETCHPROXY = '1'; // skip the fetchproxy fallback
    const fn = stubFetch();
    const c = new SetlistWebClient();
    await expect(c.fetchPage('/x')).rejects.toThrow(/SETLIST_SESSION_COOKIE|session/i);
    expect(fn).not.toHaveBeenCalled();
  });
});
