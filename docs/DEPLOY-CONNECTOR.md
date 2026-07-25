# Deploying the Groupon remote connector

This is the operator runbook for standing up `groupon-mcp` as a hosted
Cloudflare Worker — a "remote connector" that anyone you share the URL with can
add to claude.ai (web, desktop, or mobile). It's a manual, one-time (per
operator) process; there is no CI/CD path for it, and none of the steps below
can be done by an agent since they require your own Cloudflare account.

If you just want the server on your own machine talking to Groupon, you don't
need any of this — see the main [README](../README.md) for the local stdio /
`.mcpb` install instead.

## Read-only, and no credentials

This connector is **read-only**. It registers only the read tools:
`groupon_search_deals`, `groupon_get_deal`, `groupon_list_categories`, and
`groupon_healthcheck`. There is no purchase / write tool in the codebase, and
`src/worker.ts` is structured so that any future purchase / cookie module stays
out of the Worker bundle entirely.

Groupon's consumer deal reads hit an **anonymous** GraphQL endpoint — no API
key, no account, no cookie. So, unlike most connectors, this one collects **no
secret at all**:

- There are **no operator-level Groupon credentials** to configure.
- Each user who adds the connector is shown a login page that asks only for a
  free-text **label** for the connection ("type anything — no Groupon account
  needed"). Nothing is stored beyond the OAuth grant id. On submit, the Worker
  proves the anonymous endpoint is reachable with a cheap public read
  (`browseDealFeed` for `coffee` in `new-york`, limit 1) and authorizes the
  session with **empty** props.

## Prerequisites

- A Cloudflare account (free tier is fine).
- Node and this repo checked out with dependencies installed (`npm install`).

## Steps

### 1. Log in to Cloudflare

```sh
npx wrangler login
```

This opens a browser to authorize the CLI against your Cloudflare account.

### 2. Create the OAuth KV namespace

The connector stores OAuth state in a KV namespace bound as `OAUTH_KV` (see
`wrangler.jsonc`).

```sh
npx wrangler kv namespace create groupon-connector-oauth
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
`GrouponMcpAgent` per-session agent Durable Object and the `OAUTH_KV` namespace
from step 2). On success it prints the deployed URL:

```
https://groupon-connector.<your-subdomain>.workers.dev
```

Because `wrangler.jsonc` also declares a custom-domain route
(`connector.groupon.nullnet.app`), the connector is additionally served at:

```
https://connector.groupon.nullnet.app
```

Use the custom domain as the stable production URL you share. (The zone must be
in the deploying Cloudflare account; if it isn't, remove the `routes` entry from
`wrangler.jsonc` and use the `*.workers.dev` URL instead.) Note whichever URL
you use — it's what gets added as a connector, with `/mcp` appended.

> **Stateless — no cache Durable Object.** This connector keeps no per-user
> cache. The only Durable Object is the harness's per-session MCP agent
> (`GrouponMcpAgent`, SQLite migration `v1` in `wrangler.jsonc`), applied
> automatically by `wrangler deploy` — no extra setup.

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
   `https://connector.groupon.nullnet.app/mcp` (or, without a custom domain,
   `https://groupon-connector.<your-subdomain>.workers.dev/mcp`).
3. Claude will open the connector's login page (served by the Worker at
   `/authorize`). It asks only for a label for the connection — type anything.
   On submit the Worker verifies Groupon is reachable and authorizes.

This connector is unlisted: it only shows up for people you've explicitly shared
the URL with, not in any public directory.

### 5. Verify on the mobile Claude app

Connectors added on claude.ai sync to all clients for that account, including
the **mobile Claude app**. On mobile:

1. Confirm the connector appears (Settings → Connectors) and shows as connected.
2. Run a read, e.g. ask Claude to `groupon_healthcheck` or
   `groupon_search_deals` for "massage" in "chicago".

If that works, the deploy is verified end-to-end.

## How auth works

- There are **no credentials of any kind.** Groupon's consumer deal reads are
  anonymous, so there is no operator app secret and no per-user secret.
- The login page the Worker serves at `/authorize` collects only a non-secret
  label (the OAuth provider needs a `userId`, so the connector uses whatever the
  user types). The submit handler verifies reachability with a public read and
  stores **empty** props — there is nothing sensitive at rest.

## Rotation / teardown

There are no secrets to rotate. Tear down the whole connector:

```sh
npx wrangler kv namespace delete --namespace-id <id-from-step-2>
```

then delete the Worker itself from the Cloudflare dashboard (Workers &
Pages → `groupon-connector` → Settings → Delete), or via:

```sh
npx wrangler delete
```
