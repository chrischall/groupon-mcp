# groupon-mcp

MCP server for [Groupon](https://www.groupon.com), over stdio. Two surfaces:

- **Deal reads** (anonymous): search/browse, deal detail, category taxonomy and a live healthcheck, against Groupon's public consumer GraphQL endpoint. No API key, no account, no cookies.
- **Cart writes** (signed-in): view the cart, add a deal option (`groupon_purchase`), clear the cart. These act on the user's real Groupon account through its **session cookie**, either lifted from a signed-in groupon.com tab by the ContextMint Bridge (fetchproxy) or set as `GROUPON_SESSION_COOKIE`. Both writes are confirmation-gated by mcp-utils' `confirmWrite`. Checkout is hand-off only: there is no place-order API, so `groupon_purchase` ends at "added to cart" and returns the checkout URL.

## Commands

```bash
npm run build          # tsc + esbuild bundle → dist/index.js + dist/bundle.js
npm test               # tsc typecheck + vitest run
npm run test:watch     # vitest watch
npm run test:coverage  # tsc typecheck + vitest run --coverage (v8 reporter, no thresholds)
```

Run locally (requires built `dist/`):
```bash
node dist/index.js
```

## Tool naming

All tools are prefixed `groupon_`: `groupon_healthcheck`, `groupon_search_deals`, `groupon_get_deal`, `groupon_list_categories` (reads), and `groupon_view_cart`, `groupon_purchase`, `groupon_clear_cart` (cart). Keep `manifest.json`'s `tools` list in step; `tests/server-boot.test.ts` fails when it drifts.

## Architecture

```
src/
  version.ts            # single source of truth for VERSION (x-release-please-version)
  index.ts              # MCP server entry — runMcp wires every register*Tools
  client.ts             # GrouponClient: anonymous reads (BrowseDealFeed, getDeal, GetMainNavigation)
  web-client.ts         # GrouponWebClient: cookie-carrying cart ops (GetCart, createOrUpdateCartItem, deleteCartItem)
  fetchproxy-cookie.ts  # lifts the session Cookie from the browser (lazy-imported)
  transport.ts          # shared createApiClient transport + error mapping
  graphql-ops.ts        # persisted-query op builders + hashes
  view.ts               # the `view` (compact/full) parameter
  tools/                # healthcheck, deals, detail, cart
```

Each tool file exports a `register<Domain>Tools(server, deps)` function that calls `server.registerTool(name, { description, annotations, inputSchema }, handler)` (high-level `McpServer` API with zod schemas) and returns results via `textResult(...)`. `index.ts` wires them through `runMcp` from `@chrischall/mcp-utils`.

## Groupon read endpoint

Groupon deal reads use a consumer GraphQL endpoint reachable from a plain server-side fetch with **no cookies, no auth, no bot wall**:

```
POST https://www.groupon.com/mobilenextapi/graphql
headers: { 'content-type': 'application/json', 'apollographql-client-name': 'mobilenextapi' }
```

The body is a **batched array** of Apollo Automatic-Persisted-Query (APQ) ops. Introspection is disabled and the server masks all GraphQL errors as opaque 400 HTML, so **do not hand-author queries** — use Groupon's own persisted-query hash.

Verified search/browse op (`operationName: "BrowseDealFeed"`, persisted-query
`sha256Hash: b035b25dceb8a84a64c618345cc21a14897b7328506a39b2e27fc7ca4ec2f429`, version 1):

```jsonc
variables: {
  dealFeedParams: {
    limit: <int>, division: "<city-slug>" /* e.g. new-york, syracuse, chicago */,
    locationFromUrl: false,
    filters: [{ key: "query", subKey: null, value: { static: "<search term>" } }], // omit entirely for a plain category/city browse
    offset: <int>, feedToken: null, includeLocationsCount: true
  },
  browseParams: { pathName: "/search", isFetchMore: false },
  allLocations: false
}
```

Response: `data.browseDealFeed = { cards, facets, pagination, browseProps: { breadcrumbs }, __typename }`. The batched response is a **top-level JSON array**; `element[0].data.browseDealFeed` holds the feed. If the hash goes stale the server returns `{ errors: [{ message: "PersistedQueryNotFound" }] }` — surface that as an actionable `McpToolError` telling the user the persisted hash needs re-capture.

## Environment

No environment variables are required for the read path — the consumer endpoint is public. The cart path uses `GROUPON_SESSION_COOKIE` (optional; else the browser bridge, which `GROUPON_DISABLE_FETCHPROXY=1` turns off). `GROUPON_GRAPHQL_URL` overrides the endpoint, but the cart client refuses any override that is not `https://*.groupon.com`, so the cookie never leaves Groupon. See `.env.example`.

Local dev still loads `.env` via `dotenv` (guarded import; the mcpb bundle omits `dotenv` and the host provides env). `readEnvVar` treats blank, `"undefined"`, `"null"`, and unsubstituted `${FOO}` placeholders as unset.

## Testing

Tests live in `tests/` (vitest). `tests/server-boot.test.ts` spawns the real built artifacts (`dist/bundle.js` with no `node_modules`, and `dist/index.js`) and asserts the `initialize` + `tools/list` handshake. `tests/version-sync.test.ts` guards the version markers.

**Vitest gotcha (tool error-path tests):** when a `beforeEach(mockClear)` is in play, an *eager* `mockRejectedValue(...)` loses vitest's settled-result tracking and the rejection is mis-reported as unhandled. Reject *lazily* instead: `mock.mockImplementationOnce(() => Promise.reject(new Error(...)))`.

## Versioning

Version lives in `src/version.ts` (`VERSION`, marked `// x-release-please-version`) and is mirrored into `package.json`, `manifest.json`, `server.json` (×2), and the two `.claude-plugin/*` manifests. **Don't hand-bump** — release-please owns it via the `extra-files` list in `release-please-config.json`. `versionSyncTest` (in `tests/version-sync.test.ts`) fails the build if any `x-release-please-version` marker drifts from `package.json`.

## Publishing constraints

The MCP Registry caps `server.json`'s `description` at **100 characters** — over that, `mcp-publisher publish` 422s. Check with `jq -r '.description | length' server.json`.

<!-- pr-workflow:v3 -->
## Pull requests & release notes

Fleet policy — Conventional-Commit PR titles, labels, the auto-review /
auto-merge ladder, auto-review follow-up issues, PR timing, and release PRs —
lives in `~/.claude/CLAUDE.md`. Don't restate it here; the copies drifted.

Shared technical conventions (publishing, bundling, versioning guards,
write-verification, transport archetypes, testing traps) live in
[`chrischall/workflows`](https://github.com/chrischall/workflows):
`docs/fleet-conventions.md`, plus `README.md` for the CI pipeline contract.

## Gotchas

- **ESM + NodeNext**: relative imports use `.js` extensions even from `.ts` source.
- **stdio transport**: server logs to **stderr** only — stdout is reserved for JSON-RPC.
- **Zod v4 bundle alias**: `scripts/bundle.mjs` resolves `zod/v4` through Node's exports map and aliases it to the CommonJS export. Bundling the ESM export directly breaks SDK v2's Zod class initialization; runtime resolution keeps the workaround independent of npm hoisting and the current working directory.
- **Lazy optional deps in the bundle**: the `.mcpb` ships no `node_modules`; keep any externalized/optional dep import lazy (`await import(...)`) so the bundled server boots.
- **Don't hand-author GraphQL**: Groupon disables introspection and masks errors as opaque 400 HTML — always use the captured persisted-query hash.
