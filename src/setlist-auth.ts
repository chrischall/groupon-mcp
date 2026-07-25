import type { ConnectorAuth } from '@chrischall/mcp-connector';
import { SetlistClient } from './client.js';

/**
 * OAuth props stored per user by the Cloudflare connector's OAuth provider.
 *
 * setlist.fm's read API authenticates with a single long-lived `x-api-key`, so
 * — unlike the OFW connector (which stores a username + password to re-login
 * every few hours) — we store just the user's own API key. It never expires, so
 * there's no refresh path: `worker.ts`'s `buildClient` turns this straight into
 * a per-user `SetlistClient`. These props are encrypted at rest in `OAUTH_KV` by
 * the OAuth provider.
 *
 * The index signature satisfies `createConnector`'s
 * `Props extends Record<string, unknown>` constraint.
 */
export interface SetlistProps {
  apiKey: string;
  [key: string]: unknown;
}

/**
 * `ConnectorAuth` for the setlist.fm remote connector: the login page collects
 * the user's own setlist.fm API key, verifies it with a cheap read against the
 * public REST API (the same `/1.0/search/countries` probe `setlist_healthcheck`
 * uses), and stores `{ apiKey }` as the OAuth props that `worker.ts`'s
 * `buildClient` turns into a per-user `SetlistClient`.
 *
 * READ-ONLY connector: this is the API-key surface only. The cookie-session
 * attendance-write path (`web-client.ts` / `fetchproxy-cookie.ts`) is
 * deliberately excluded from the Worker — it has no hosted session refresh.
 */
export const setlistAuth: ConnectorAuth<SetlistProps> = {
  service: 'setlist.fm',
  accent: '#1D2939',
  privacyNote:
    'Your setlist.fm API key is stored encrypted and used only to make read-only calls to the setlist.fm API on your behalf. ' +
    'Apply for a free key at https://www.setlist.fm/settings/api.',
  fields: [{ name: 'apiKey', label: 'setlist.fm API key', type: 'password' }],
  async login(fields) {
    // Verify the key up front — a bad key makes the setlist.fm API answer 401/403,
    // which `request()` throws and the connector surfaces back on the login page.
    // `/1.0/search/countries` is the cheapest authenticated read (a small static
    // list), the same probe `setlist_healthcheck` uses.
    const client = new SetlistClient({ apiKey: fields.apiKey });
    await client.request('GET', '/1.0/search/countries');
    return { apiKey: fields.apiKey };
  },
};
