import type { ConnectorAuth } from '@chrischall/mcp-connector';
import { GrouponClient } from './client.js';

/**
 * OAuth props stored per user by the Cloudflare connector's OAuth provider.
 *
 * Groupon's deal reads hit an ANONYMOUS consumer GraphQL endpoint — no API key,
 * no account, no cookie. So unlike connectors that persist a user's API key or
 * login credentials, there is nothing secret to store here: the props are empty.
 * `worker.ts`'s `buildClient` ignores them and constructs a credential-free
 * `GrouponClient`.
 *
 * The index signature satisfies `createConnector`'s
 * `Props extends Record<string, unknown>` constraint while carrying no fields.
 */
export interface GrouponProps {
  [key: string]: unknown;
}

/**
 * `ConnectorAuth` for the Groupon remote connector.
 *
 * Groupon deal reads are PUBLIC — they need no credential — so this login page
 * collects no secret. But `@chrischall/mcp-connector`'s `handleAuthorize` still
 * needs a first field to use as the OAuth `userId` (it reads
 * `auth.fields[0].name`), and a zero-field form would crash the POST that
 * completes authorization. So we present a SINGLE, non-secret label field: the
 * user types anything they like (a name for the connection) and we never store
 * or use it beyond the OAuth grant id. `login()` collects no real credential; it
 * simply proves the anonymous endpoint is reachable with a cheap probe read and
 * returns empty props.
 */
export const grouponAuth: ConnectorAuth<GrouponProps> = {
  service: 'Groupon',
  accent: '#53a318',
  privacyNote:
    'Groupon deal reads are public; no account, API key, or password is required or stored. ' +
    'This field is just a label for your connection — type anything.',
  fields: [
    { name: 'label', label: 'A name for this connection (anything — no Groupon account needed)', type: 'text' },
  ],
  async login() {
    // No credential to verify — instead prove the anonymous GraphQL endpoint is
    // reachable and answering, with the same cheap public read the connector's
    // tools use. A network/shape failure throws here and the connector surfaces
    // it back on the login page rather than silently authorizing a dead service.
    const client = new GrouponClient();
    await client.browseDealFeed({ query: 'coffee', division: 'new-york', limit: 1, offset: 0 });
    return {};
  },
};
