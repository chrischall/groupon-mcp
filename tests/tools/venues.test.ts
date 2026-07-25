import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { client } from '../../src/client.js';
import { registerVenueTools } from '../../src/tools/venues.js';
import { createTestHarness } from '../helpers.js';

const mockRequest = vi.spyOn(client, 'request').mockResolvedValue(undefined as never);
let harness: Awaited<ReturnType<typeof createTestHarness>>;

beforeEach(() => mockRequest.mockClear());
afterAll(async () => {
  if (harness) await harness.close();
});

describe('venue tools', () => {
  it('setup', async () => {
    harness = await createTestHarness((server) => registerVenueTools(server, client));
  });

  it('setlist_search_venues forwards filters as query', async () => {
    mockRequest.mockResolvedValue({ venue: [] });
    await harness.callTool('setlist_search_venues', { name: 'Madison Square Garden' });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/search/venues', {
      query: { name: 'Madison Square Garden' },
    });
  });

  it('setlist_get_venue hits /1.0/venue/{id}', async () => {
    mockRequest.mockResolvedValue({ id: '6bd6ca6e' });
    await harness.callTool('setlist_get_venue', { venueId: '6bd6ca6e' });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/venue/6bd6ca6e');
  });

  it('setlist_get_venue_setlists passes the page param', async () => {
    mockRequest.mockResolvedValue({ setlist: [] });
    await harness.callTool('setlist_get_venue_setlists', { venueId: '6bd6ca6e', p: 2 });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/venue/6bd6ca6e/setlists', {
      query: { p: 2 },
    });
  });
});
