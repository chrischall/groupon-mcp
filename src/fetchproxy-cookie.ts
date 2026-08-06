// ────────────────────────────────────────────────────────────────────────────
// Session-cookie resolution — createAuthResolver (shared skeleton, mcp-utils)
// ────────────────────────────────────────────────────────────────────────────
//
// Groupon's CART ops hit the same GraphQL endpoint as the anonymous reads, but
// require the user's AUTHENTICATED SESSION COOKIE — the cookie ALONE (verified
// 2026-07-25: GetCart returned data with just the cookie; NO x-sig-fraud-check,
// NO CSRF header). This module resolves that `Cookie` header via the canonical
// three-path resolver shared with the rest of the fleet (setlist / zola / ofw):
//
//   1. Env credential — GROUPON_SESSION_COOKIE set → used directly (hardened
//      readEnvVar semantics inside the resolver).
//   2. fetchproxy fallback — unless GROUPON_DISABLE_FETCHPROXY is truthy, lift
//      the logged-in groupon.com session out of the signed-in browser tab (via
//      the Transporter extension) and use the captured `Cookie` header —
//      fetchproxy is NOT in the hot path afterward.
//   3. Error — nothing configured: an actionable message naming
//      GROUPON_SESSION_COOKIE and the browser sign-in fallback.
//
// This module is lazy-imported by web-client.ts, so the env path there never
// loads the bridge; `@fetchproxy/bootstrap` (and, transitively,
// `@fetchproxy/server` via the `/fetchproxy` subpath) stays out of the eager
// module graph so the .mcpb bundle never loads it.
//
// Capturing the WHOLE cookie header (the alltrails capture-header pattern) is
// more robust than enumerating Groupon's individual cookie names — the session
// is a bundle of several cookies whose names can churn, but the browser already
// assembles the exact `Cookie` header on its own /mobilenextapi/graphql
// requests, so we snapshot that verbatim.

import { bootstrap } from '@fetchproxy/bootstrap';
import {
  createAuthResolver,
  parseCookieJar,
  type BootstrapFn,
  type FetchproxySession,
} from '@chrischall/mcp-utils';
import { withDeadline } from '@chrischall/mcp-utils/fetchproxy';
import { VERSION } from './version.js';

// Bound the bridge round-trip so a wedged/absent extension fails fast instead of
// hanging the tool call.
const BOOTSTRAP_TIMEOUT_MS = 15_000;

// The real bootstrap has a narrower opts type than the injected boundary; the
// cast keeps the heavy bridge dep out of the shared module's types. withDeadline
// (from @fetchproxy/server via the mcp-utils /fetchproxy subpath) races the
// bridge round-trip against the timer and never folds an inner rejection into a
// timeout.
const bootstrapWithDeadline: BootstrapFn = async (opts) => {
  const outcome = await withDeadline((bootstrap as unknown as BootstrapFn)(opts), BOOTSTRAP_TIMEOUT_MS);
  if (outcome.timedOut) {
    throw new Error(
      'fetchproxy: timed out waiting for the browser bridge. Is the Transporter extension running and signed into groupon.com in that browser?',
    );
  }
  return outcome.value;
};

// The runtime bootstrap session also carries `capturedHeaders` (request headers
// snapshotted during the bootstrap navigation), which the shared
// `FetchproxySession` type — modelling only cookies/localStorage/sessionStorage
// — does not declare. Widen it locally to read the captured `Cookie` header.
type SessionWithCapturedHeaders = FetchproxySession & {
  capturedHeaders?: Record<string, string>;
};

const resolveAuth = createAuthResolver({
  envVar: 'GROUPON_SESSION_COOKIE',
  disableEnvVar: 'GROUPON_DISABLE_FETCHPROXY',
  bootstrap: bootstrapWithDeadline,
  // Declare the apex `groupon.com` scope (so a re-render with no scope change
  // never needs re-approval), read from the `www` subdomain, and capture the
  // whole `cookie` header off the site's own /mobilenextapi/graphql request.
  bootstrapOptions: {
    serverName: 'groupon-mcp',
    version: VERSION,
    domains: ['groupon.com'],
    storageSubdomain: 'www',
    declare: {
      cookies: [],
      localStorage: [],
      sessionStorage: [],
      captureHeaders: [
        { host: 'www.groupon.com', path: '/mobilenextapi/graphql', headerName: 'cookie' },
      ],
    },
  },
  parseTokens: (session) => {
    const s = session as SessionWithCapturedHeaders;
    // Primary: the verbatim `Cookie` header the browser sent on its own cart
    // request (case-insensitive on the captured key).
    const captured = s.capturedHeaders?.['cookie'] ?? s.capturedHeaders?.['Cookie'];
    if (captured && captured.trim()) return captured;
    // Fallback: assemble from individual cookies if the capture missed but the
    // bridge surfaced named cookies. A bare, empty jar is not a session — return
    // undefined so the resolver raises its "sign in at groupon.com" error.
    const cookies: Record<string, string> = session.cookies ?? {};
    const pairs = Object.keys(cookies)
      .filter((k) => cookies[k])
      .map((k) => `${k}=${cookies[k]}`);
    if (pairs.length === 0) return undefined;
    return parseCookieJar(pairs).cookieHeader || undefined;
  },
  serviceName: 'Groupon',
  signInHost: 'www.groupon.com',
});

/** Result of resolving the Groupon session cookie, regardless of path taken. */
export interface ResolvedSessionCookie {
  /** Full `Cookie` header for authenticated www.groupon.com cart requests. */
  cookieHeader: string;
  /** Which path produced it. Diagnostics only — do not branch on it. */
  source: 'env' | 'fetchproxy';
}

/**
 * Resolve the Groupon session `Cookie` header using the three-path priority
 * described above. Throws an actionable error when no path succeeds (bridge
 * unreachable / signed out / fallback disabled with no env cookie).
 */
export async function resolveSessionCookie(): Promise<ResolvedSessionCookie> {
  const { credential, source } = await resolveAuth();
  return { cookieHeader: credential, source };
}
