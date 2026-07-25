// ────────────────────────────────────────────────────────────────────────────
// Session-cookie resolution — createAuthResolver (shared skeleton, mcp-utils)
// ────────────────────────────────────────────────────────────────────────────
//
// The canonical three-path "browser-bootstrap + Node-direct" resolver (the
// fleet-standard shape shared with zola / ofw / resy / opentable):
//
//   1. Env credential — SETLIST_SESSION_COOKIE set → used directly (hardened
//      readEnvVar semantics inside the resolver).
//   2. fetchproxy fallback — unless SETLIST_DISABLE_FETCHPROXY is truthy
//      ('1'/'true'/'yes'/'on' via parseBoolEnv inside the resolver), lift the
//      logged-in setlist.fm session cookies out of the signed-in browser tab
//      (via the Transporter extension) and assemble a `Cookie` header —
//      fetchproxy is NOT in the hot path afterward.
//   3. Error — nothing configured: an actionable message naming
//      SETLIST_SESSION_COOKIE and the browser sign-in fallback.
//
// This module is lazy-imported by web-client.ts, so the env path there never
// loads the bridge; `@fetchproxy/bootstrap` is bundled into dist/bundle.js
// (NOT externalized) and esbuild keeps the whole dynamically-imported graph —
// including `@chrischall/mcp-utils/fetchproxy`'s eager `@fetchproxy/server`
// import — lazily initialized, so the .mcpb still boots without node_modules
// (pinned by tests/server-boot.test.ts).

import { bootstrap } from '@fetchproxy/bootstrap';
import { createAuthResolver, parseCookieJar, type BootstrapFn } from '@chrischall/mcp-utils';
import { withDeadline } from '@chrischall/mcp-utils/fetchproxy';
import { VERSION } from './version.js';

// The cookies that authenticate a www.setlist.fm session: JSESSIONID is the
// (HttpOnly) Wicket session, RememberMeCookie re-establishes login, aws-waf-token
// clears the WAF. read_cookies uses chrome.cookies.get, which DOES see HttpOnly
// cookies (page JS cannot), so the bridge can lift JSESSIONID.
const SESSION_COOKIE_KEYS = ['JSESSIONID', 'RememberMeCookie', 'aws-waf-token'];

// Bound the bridge round-trip so a wedged/absent extension fails fast instead of
// hanging the tool call.
const BOOTSTRAP_TIMEOUT_MS = 15_000;

// The real bootstrap has a narrower opts type than the injected boundary; the
// cast keeps the heavy bridge dep out of the shared module's types (same shape
// as zola's auth.ts). withDeadline (shared, from @fetchproxy/server via the
// mcp-utils /fetchproxy subpath) races the bridge round-trip against the timer
// and never folds an inner rejection into a timeout.
const bootstrapWithDeadline: BootstrapFn = async (opts) => {
  const outcome = await withDeadline((bootstrap as unknown as BootstrapFn)(opts), BOOTSTRAP_TIMEOUT_MS);
  if (outcome.timedOut) {
    throw new Error(
      'fetchproxy: timed out waiting for the browser bridge. Is the Transporter extension running and signed into setlist.fm in that browser?',
    );
  }
  return outcome.value;
};

const resolveAuth = createAuthResolver({
  envVar: 'SETLIST_SESSION_COOKIE',
  disableEnvVar: 'SETLIST_DISABLE_FETCHPROXY',
  bootstrap: bootstrapWithDeadline,
  // Declare the apex `setlist.fm` scope (so a re-render with no scope change
  // never needs re-approval), but read cookies from the `www` subdomain — the
  // session cookies are host-only on www.setlist.fm, and www is a subdomain of
  // the approved apex, so chrome.cookies.get sees JSESSIONID without a re-pair.
  bootstrapOptions: {
    serverName: 'setlist-mcp',
    version: VERSION,
    domains: ['setlist.fm'],
    storageSubdomain: 'www',
    declare: { cookies: SESSION_COOKIE_KEYS, localStorage: [], sessionStorage: [], captureHeaders: [] },
  },
  parseTokens: (session) => {
    const cookies: Record<string, string> = session.cookies ?? {};
    // A bare aws-waf-token is not a session — require a login cookie so the
    // resolver raises its "sign in at www.setlist.fm" error instead.
    if (!cookies.JSESSIONID && !cookies.RememberMeCookie) return undefined;
    // parseCookieJar dedupes + drops empty values and pre-joins the header.
    return parseCookieJar(SESSION_COOKIE_KEYS.filter((k) => cookies[k]).map((k) => `${k}=${cookies[k]}`))
      .cookieHeader;
  },
  serviceName: 'setlist.fm',
  signInHost: 'www.setlist.fm',
});

/** Result of resolving the setlist.fm session cookie, regardless of path taken. */
export interface ResolvedSessionCookie {
  /** Full `Cookie` header for authenticated www.setlist.fm requests. */
  cookieHeader: string;
  /** Which path produced it. Diagnostics only — do not branch on it. */
  source: 'env' | 'fetchproxy';
}

/**
 * Resolve the setlist.fm session `Cookie` header using the three-path priority
 * described above. Throws an actionable error when no path succeeds (bridge
 * unreachable / signed out / fallback disabled with no env cookie).
 */
export async function resolveSessionCookie(): Promise<ResolvedSessionCookie> {
  const { credential, source } = await resolveAuth();
  return { cookieHeader: credential, source };
}
