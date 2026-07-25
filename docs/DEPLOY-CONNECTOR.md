# Deploying the setlist.fm remote connector

This is the operator runbook for standing up `setlist-mcp` as a hosted
Cloudflare Worker — a "remote connector" that anyone you share the URL with can
add to claude.ai (web, desktop, or mobile), each logging in with their own
setlist.fm API key. It's a manual, one-time (per operator) process; there is no
CI/CD path for it, and none of the steps below can be done by an agent since
they require your own Cloudflare account.

If you just want the server on your own machine talking to setlist.fm with your
own API key, you don't need any of this — see the main [README](../README.md)
for the local stdio / `.mcpb` install instead.

## Read-only

This connector is **read-only**. It registers only the API-key read tools
(artist / setlist / venue / geo / user lookups, resolve, URL parsing, and the
healthcheck). The attendance-write tools (`setlist_mark_attended` /
`setlist_unmark_attended`) are **not** part of the hosted connector: they
authenticate via a cookie session (`SETLIST_SESSION_COOKIE` / the fetchproxy
browser bridge) that has no hosted refresh path, so that code is deliberately
kept out of the Worker bundle. Attendance writes remain available on the local
stdio server.

## Prerequisites

- A Cloudflare account (free tier is fine).
- Node and this repo checked out with dependencies installed (`npm install`).
- **No app-level setlist.fm API keys are required from you.** Each user
  authenticates with their *own* setlist.fm API key, collected by the
  connector's own OAuth login page (step 4) — you never handle anyone's key.
  Users apply for a free key at <https://www.setlist.fm/settings/api>.

## Steps

### 1. Log in to Cloudflare

```sh
npx wrangler login
```

This opens a browser to authorize the CLI against your Cloudflare account.

### 2. Create the OAuth KV namespace

The connector stores OAuth state and per-user session data in a KV namespace
bound as `OAUTH_KV` (see `wrangler.jsonc`).

```sh
npx wrangler kv namespace create OAUTH_KV
```

The command prints something like:

```
{ "binding": "OAUTH_KV", "id": "abcd1234..." }
```

Copy the returned `id` into `wrangler.jsonc`, replacing the
`"REPLACE_WITH_OAUTH_KV_NAMESPACE_ID"` placeholder:

```jsonc
"kv_namespaces": [{ "binding": "OAUTH_KV", "id": "abcd1234..." }],
```

### 3. Deploy

```sh
npm run worker:deploy
```

This runs `wrangler deploy`, which builds and pushes `src/worker.ts` (plus the
`SetlistMcpAgent` per-session agent Durable Object and the `OAUTH_KV` namespace
from step 2). On success it prints the deployed URL:

```
https://setlist-connector.<your-subdomain>.workers.dev
```

Because `wrangler.jsonc` also declares a custom-domain route
(`connector.setlist.nullnet.app`, matching ofw-connector's
`connector.ofw.nullnet.app`), the connector is additionally served at:

```
https://connector.setlist.nullnet.app
```

Use the custom domain as the stable production URL you share. (The zone must be
in the deploying Cloudflare account; if it isn't, remove the `routes` entry from
`wrangler.jsonc` and use the `*.workers.dev` URL instead.) Note whichever URL
you use — it's what gets added as a connector, with `/mcp` appended.

> **Stateless — no cache Durable Object.** Unlike ofw-connector, this connector
> keeps no per-user cache. The only Durable Object is the harness's per-session
> MCP agent (`SetlistMcpAgent`, SQLite migration `v1` in `wrangler.jsonc`),
> applied automatically by `wrangler deploy` — no extra setup.

Before deploying to production, you can sanity-check the Worker locally with:

```sh
npm run worker:dev
```

confirm it bundles without deploying:

```sh
npx wrangler deploy --dry-run
```

and run the Worker-specific test suite (Miniflare / real Workers runtime) with:

```sh
npm run worker:test
```

### 4. Add it as a connector in claude.ai

1. Go to claude.ai → **Settings** → **Connectors** → **Add custom connector**.
2. Paste the deployed URL with `/mcp` appended — the custom domain
   `https://connector.setlist.nullnet.app/mcp` (or, without a custom domain,
   `https://setlist-connector.<your-subdomain>.workers.dev/mcp`).
3. Claude will open the connector's login page (served by the Worker at
   `/authorize`) and prompt for a **setlist.fm API key**. The key is verified
   against the setlist.fm API on submit and stored encrypted in `OAUTH_KV`.

This connector is unlisted: it only shows up for people you've explicitly shared
the URL with, not in any public directory. Anyone with the URL who supplies a
valid setlist.fm API key can use it under their own key.

### 5. Verify on the mobile Claude app

Connectors added on claude.ai sync to all clients for that account, including
the **mobile Claude app**. On mobile:

1. Confirm the connector appears (Settings → Connectors) and shows as connected.
2. Run a read, e.g. ask Claude to `setlist_healthcheck` or
   `setlist_search_artists` for a band you like.

If that works, the deploy is verified end-to-end.

## How auth works

- There are **no operator-level setlist.fm credentials.** setlist.fm has no
  shared app `client_id` / `client_secret`; the connector authenticates each
  user individually with their own API key.
- Each **user** who adds the connector supplies their *own* setlist.fm API key
  via the login page the Worker serves at `/authorize`. It's verified up front
  with a cheap read (`/1.0/search/countries`, the same probe
  `setlist_healthcheck` uses); a bad key is rejected on the login page.
- The key is stored **encrypted at rest** in the OAuth provider's KV-backed
  "props" (`OAUTH_KV`), scoped to that user's session. setlist.fm API keys are
  long-lived and never expire, so there's no refresh path — the key is used only
  to make read-only setlist.fm API calls on that user's behalf.

## Rotation / teardown

There are no operator secrets to rotate (users manage their own setlist.fm API
keys). Tear down the whole connector:

```sh
npx wrangler kv namespace delete --namespace-id <id-from-step-2>
```

then delete the Worker itself from the Cloudflare dashboard (Workers &
Pages → `setlist-connector` → Settings → Delete), or via:

```sh
npx wrangler delete
```

Deleting the KV namespace invalidates every stored user session — everyone who
had added the connector will need to log in again (re-supply their API key) if
it's redeployed.
