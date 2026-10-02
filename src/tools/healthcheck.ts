import type { McpServer } from "@modelcontextprotocol/server";
import { ApiError, EdgeBlockedError, readEnvVar } from "@chrischall/mcp-utils";
import { registerCredentialHealthcheckTool } from "@chrischall/mcp-utils/healthcheck";
import { StalePersistedQueryError, type GrouponClient } from "../client.js";
import { GrouponAuthRejected } from "../transport.js";
import { VERSION } from "../version.js";

/**
 * `groupon_healthcheck` — one live round-trip to Groupon's consumer GraphQL
 * endpoint through the shared credential-healthcheck ladder, so every failure
 * reports a `kind` (chrischall/mcp-host#1015):
 *
 *  - `edge_blocked`: a CDN/WAF refusal page (Groupon's www host sits behind
 *    Akamai) — checked by the shared ladder before any status rule;
 *  - `http`: any other non-2xx, INCLUDING a plain 401/403 — the deal reads
 *    send no credential, so a refusal cannot mean a rejected one;
 *  - `stale_persisted_query`: the persisted hashes need re-capture;
 *  - `timeout` / `transport` / `unknown` from the shared ladder.
 *
 * The reads are anonymous, so the "credential" is reported as `anonymous`;
 * the cart session's SOURCE (never its value) rides along as detail. The probe
 * deliberately does not lift the browser cookie: a diagnostic observes, and a
 * lift would spend a bridge round-trip on every check.
 */
export function registerHealthcheckTools(server: McpServer, client: GrouponClient): void {
  const url = new URL(client.endpoint);
  registerCredentialHealthcheckTool({
    server,
    prefix: "groupon",
    hostLabel: url.host,
    probePath: `${url.pathname}${url.search}`,
    resolveCredential: async () => ({
      source: "anonymous",
      detail: {
        version: VERSION,
        reads: "public endpoint; no credential is sent",
        cart_session:
          readEnvVar("GROUPON_SESSION_COOKIE") !== undefined
            ? "GROUPON_SESSION_COOKIE"
            : "browser bridge (lifted on the first cart call)",
      },
    }),
    probeFn: () => client.probe(),
    classifyThrown: (err) => {
      if (err instanceof StalePersistedQueryError) {
        return { kind: "stale_persisted_query", hint: err.hint ?? err.message };
      }
      // Leave a block to the shared ladder, which names it edge_blocked.
      if (err instanceof EdgeBlockedError) return undefined;
      // A 401 arrives as GrouponAuthRejected (the transport's onUnauthorized).
      const status =
        err instanceof GrouponAuthRejected ? err.status : err instanceof ApiError ? err.status : undefined;
      if (status === 401 || status === 403) {
        return {
          kind: "http",
          hint:
            `${url.host} refused an anonymous request with ${status}. The deal reads send no credential, ` +
            "so this is not a rejected one — it is an upstream refusal. Retry later; if it persists, check error.message.",
        };
      }
      return undefined;
    },
    hints: {
      ok:
        `${url.host} answered a live GraphQL request, so the deal reads work. The cart tools additionally need a ` +
        "signed-in Groupon session, which is resolved on the first cart call.",
    },
  });
}
