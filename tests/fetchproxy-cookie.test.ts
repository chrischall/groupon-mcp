import { describe, it, expect, vi, afterEach } from 'vitest';

// vi.hoisted: the module under test imports @fetchproxy/bootstrap eagerly, so
// the mock fn must exist before the hoisted vi.mock factory runs.
const { bootstrap } = vi.hoisted(() => ({ bootstrap: vi.fn() }));
vi.mock('@fetchproxy/bootstrap', () => ({ bootstrap }));

import { resolveSessionCookie } from '../src/fetchproxy-cookie.js';

// Vitest gotcha (cousin of the eager-mockRejectedValue one in CLAUDE.md): a
// `beforeEach(() => bootstrap.mockReset())` HOOK wedges the fake-timer test
// below into a 10s "Hook timed out" failure — vitest's mock bookkeeping from
// the hook interacts badly with the still-pending mock result. Resetting
// inline at the top of each test avoids it.

describe('resolveSessionCookie', () => {
  afterEach(() => {
    delete process.env.SETLIST_SESSION_COOKIE;
    delete process.env.SETLIST_DISABLE_FETCHPROXY;
    vi.useRealTimers();
  });

  it('returns SETLIST_SESSION_COOKIE from the env without touching the bridge', async () => {
    bootstrap.mockReset();
    process.env.SETLIST_SESSION_COOKIE = 'JSESSIONID=env';
    await expect(resolveSessionCookie()).resolves.toEqual({
      cookieHeader: 'JSESSIONID=env',
      source: 'env',
    });
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('assembles a Cookie header from the bridge-read session cookies', async () => {
    bootstrap.mockReset();
    bootstrap.mockResolvedValue({ cookies: { JSESSIONID: 'abc', RememberMeCookie: 'rm', aws: undefined } });
    const { cookieHeader, source } = await resolveSessionCookie();
    expect(cookieHeader).toBe('JSESSIONID=abc; RememberMeCookie=rm');
    expect(source).toBe('fetchproxy');
    // declared the right cookie keys + setlist.fm domain
    const arg = bootstrap.mock.calls[0][0];
    expect(arg.domains).toEqual(['setlist.fm']);
    expect(arg.storageSubdomain).toBe('www');
    expect(arg.declare.cookies).toEqual(['JSESSIONID', 'RememberMeCookie', 'aws-waf-token']);
  });

  it('throws an actionable config error when the fallback is disabled (no bridge call)', async () => {
    bootstrap.mockReset();
    process.env.SETLIST_DISABLE_FETCHPROXY = '1';
    await expect(resolveSessionCookie()).rejects.toThrow(/SETLIST_SESSION_COOKIE/);
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('throws an actionable error when no session cookie is present', async () => {
    bootstrap.mockReset();
    bootstrap.mockResolvedValue({ cookies: { 'aws-waf-token': 'x' } });
    await expect(resolveSessionCookie()).rejects.toThrow(/sign in/i);
  });

  it('fails fast with the browser-bridge timeout message when the bridge never answers', async () => {
    bootstrap.mockReset();
    vi.useFakeTimers();
    bootstrap.mockImplementation(() => new Promise(() => {})); // wedged bridge
    const p = resolveSessionCookie();
    const assertion = expect(p).rejects.toThrow(/timed out waiting for the browser bridge/);
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });
});
