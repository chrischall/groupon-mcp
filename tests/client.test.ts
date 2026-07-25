import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SetlistClient } from '../src/client.js';

// Capture outbound fetches. createApiClient binds the global `fetch` at
// construction time, so the stub must be installed BEFORE `new SetlistClient()`.
interface Call {
  url: string;
  init: { method: string; headers: Record<string, string> };
}

describe('SetlistClient', () => {
  let calls: Call[];

  function stubFetch(body: unknown = {}, status = 200): ReturnType<typeof vi.fn> {
    const fn = vi.fn(async (url: string, init: Call['init']) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.SETLIST_API_KEY;
    delete process.env.SETLIST_ACCEPT_LANGUAGE;
  });

  it('sends the x-api-key header and JSON Accept against the rest base URL', async () => {
    process.env.SETLIST_API_KEY = 'test-key';
    stubFetch({ ok: 1 });
    const c = new SetlistClient();

    await c.request('GET', '/1.0/search/countries');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.setlist.fm/rest/1.0/search/countries');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.headers['x-api-key']).toBe('test-key');
    expect(calls[0].init.headers.Accept).toBe('application/json');
  });

  it('builds a query string and drops undefined params', async () => {
    process.env.SETLIST_API_KEY = 'k';
    stubFetch();
    const c = new SetlistClient();

    await c.request('GET', '/1.0/search/setlists', {
      query: { artistName: 'Phish', p: 2, year: undefined },
    });

    expect(calls[0].url).toBe(
      'https://api.setlist.fm/rest/1.0/search/setlists?artistName=Phish&p=2',
    );
  });

  it('adds Accept-Language when SETLIST_ACCEPT_LANGUAGE is set', async () => {
    process.env.SETLIST_API_KEY = 'k';
    process.env.SETLIST_ACCEPT_LANGUAGE = 'de';
    stubFetch();
    const c = new SetlistClient();

    await c.request('GET', '/1.0/search/countries');

    expect(calls[0].init.headers['Accept-Language']).toBe('de');
  });

  it('rewrites eventDate in responses from dd-MM-yyyy to ISO yyyy-MM-dd', async () => {
    process.env.SETLIST_API_KEY = 'k';
    stubFetch({ setlist: [{ id: 'abc', eventDate: '28-08-2025' }] });
    const c = new SetlistClient();

    const data = await c.request<{ setlist: { eventDate: string }[] }>(
      'GET',
      '/1.0/search/setlists',
    );

    expect(data.setlist[0].eventDate).toBe('2025-08-28');
  });

  it('annotates setlists with songCount/setCount/hasSongs', async () => {
    process.env.SETLIST_API_KEY = 'k';
    stubFetch({
      setlist: [
        { id: 'a', eventDate: '28-08-2025', sets: { set: [{ song: [{ name: 's1' }, { name: 's2' }] }] } },
        { id: 'stub', eventDate: '01-01-2025', sets: { set: [] } },
      ],
    });
    const c = new SetlistClient();

    const data = await c.request<{ setlist: { hasSongs: boolean; songCount: number }[] }>(
      'GET',
      '/1.0/search/setlists',
    );

    expect(data.setlist[0]).toMatchObject({ songCount: 2, setCount: 1, hasSongs: true });
    expect(data.setlist[1]).toMatchObject({ songCount: 0, setCount: 0, hasSongs: false });
  });

  it('times out a hung request with a clear, actionable error', async () => {
    process.env.SETLIST_API_KEY = 'k';
    vi.useFakeTimers();
    // A fetch that never resolves until its AbortSignal fires.
    vi.stubGlobal('fetch', (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          (e as { name: string }).name = 'AbortError';
          reject(e);
        });
      }),
    );
    const c = new SetlistClient();

    const p = c.request('GET', '/1.0/search/countries');
    const assertion = expect(p).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(60_000); // fire the timeout regardless of its exact value
    await assertion;
  });

  it('uses an injected apiKey instead of the environment (per-user constructor seam)', async () => {
    // The hosted per-user path builds a client with the caller's key; no env var
    // is set. The injected key must reach the x-api-key header.
    delete process.env.SETLIST_API_KEY;
    stubFetch();
    const c = new SetlistClient({ apiKey: 'injected-key' });

    await c.request('GET', '/1.0/search/countries');

    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers['x-api-key']).toBe('injected-key');
  });

  it('falls back to the env var when opts carries no apiKey', async () => {
    // An opts object with no apiKey must not shadow SETLIST_API_KEY — the env
    // key still wins, so the stdio singleton path stays intact.
    process.env.SETLIST_API_KEY = 'env-key';
    stubFetch();
    const c = new SetlistClient({});

    await c.request('GET', '/1.0/search/countries');

    expect(calls[0].init.headers['x-api-key']).toBe('env-key');
  });

  it('defers the config error — constructs without a key, throws on first request', async () => {
    delete process.env.SETLIST_API_KEY;
    const fn = stubFetch();

    const c = new SetlistClient(); // must NOT throw

    await expect(c.request('GET', '/1.0/search/countries')).rejects.toThrow(/SETLIST_API_KEY/);
    expect(fn).not.toHaveBeenCalled(); // no network call when the key is missing
  });
});
