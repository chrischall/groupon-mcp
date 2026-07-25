import { describe, it, expect, vi, afterEach } from 'vitest';

// vi.hoisted: the module under test imports @fetchproxy/bootstrap eagerly, so
// the mock fn must exist before the hoisted vi.mock factory runs.
const { bootstrap } = vi.hoisted(() => ({ bootstrap: vi.fn() }));
vi.mock('@fetchproxy/bootstrap', () => ({ bootstrap }));

import { resolveSessionCookie } from '../src/fetchproxy-cookie.js';

// Reset the mock inline at the top of each test (a beforeEach hook that resets a
// still-pending mock result can wedge the fake-timer test — see setlist-mcp).

describe('resolveSessionCookie', () => {
  afterEach(() => {
    delete process.env.GROUPON_SESSION_COOKIE;
    delete process.env.GROUPON_DISABLE_FETCHPROXY;
    vi.useRealTimers();
  });

  it('returns GROUPON_SESSION_COOKIE from the env without touching the bridge', async () => {
    bootstrap.mockReset();
    process.env.GROUPON_SESSION_COOKIE = 'gsession=env';
    await expect(resolveSessionCookie()).resolves.toEqual({
      cookieHeader: 'gsession=env',
      source: 'env',
    });
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('uses the captured Cookie header from the bridge session', async () => {
    bootstrap.mockReset();
    bootstrap.mockResolvedValue({
      cookies: {},
      localStorage: {},
      sessionStorage: {},
      capturedHeaders: { cookie: 'grpn=1; morsel=2; session=abc' },
    });
    const { cookieHeader, source } = await resolveSessionCookie();
    expect(cookieHeader).toBe('grpn=1; morsel=2; session=abc');
    expect(source).toBe('fetchproxy');
    // Declared the groupon.com apex, the www subdomain, and the cookie-header capture.
    const arg = bootstrap.mock.calls[0][0];
    expect(arg.domains).toEqual(['groupon.com']);
    expect(arg.storageSubdomain).toBe('www');
    expect(arg.declare.captureHeaders).toEqual([
      { host: 'www.groupon.com', path: '/mobilenextapi/graphql', headerName: 'cookie' },
    ]);
  });

  it('falls back to assembling from named cookies when no header was captured', async () => {
    bootstrap.mockReset();
    bootstrap.mockResolvedValue({
      cookies: { grpn_session: 'abc', ln: 'def' },
      localStorage: {},
      sessionStorage: {},
      capturedHeaders: {},
    });
    const { cookieHeader } = await resolveSessionCookie();
    expect(cookieHeader).toBe('grpn_session=abc; ln=def');
  });

  it('throws an actionable config error when the fallback is disabled (no bridge call)', async () => {
    bootstrap.mockReset();
    process.env.GROUPON_DISABLE_FETCHPROXY = '1';
    await expect(resolveSessionCookie()).rejects.toThrow(/GROUPON_SESSION_COOKIE/);
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('throws an actionable error when no session cookie is present', async () => {
    bootstrap.mockReset();
    bootstrap.mockResolvedValue({ cookies: {}, localStorage: {}, sessionStorage: {}, capturedHeaders: {} });
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
