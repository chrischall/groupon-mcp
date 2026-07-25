import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { client } from '../../src/client.js';
import { registerArtistTools } from '../../src/tools/artists.js';
import { createTestHarness } from '../helpers.js';

const mockRequest = vi.spyOn(client, 'request').mockResolvedValue(undefined as never);
let harness: Awaited<ReturnType<typeof createTestHarness>>;

beforeEach(() => mockRequest.mockClear());
afterAll(async () => {
  if (harness) await harness.close();
});

describe('artist tools', () => {
  it('setup', async () => {
    harness = await createTestHarness((server) => registerArtistTools(server, client));
  });

  it('setlist_search_artists passes filters through query', async () => {
    mockRequest.mockResolvedValue({ artist: [] });
    const result = await harness.callTool('setlist_search_artists', {
      artistName: 'Radiohead',
      sort: 'relevance',
    });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/search/artists', {
      query: { artistName: 'Radiohead', sort: 'relevance' },
    });
    expect(result.isError).toBeFalsy();
  });

  it('setlist_get_artist URL-encodes the mbid in the path', async () => {
    mockRequest.mockResolvedValue({ mbid: 'a74b1b7f' });
    await harness.callTool('setlist_get_artist', { mbid: 'a74b1b7f-71a0-4e99' });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/artist/a74b1b7f-71a0-4e99');
  });

  it('setlist_get_artist_setlists passes the page param', async () => {
    mockRequest.mockResolvedValue({ setlist: [] });
    await harness.callTool('setlist_get_artist_setlists', { mbid: 'abc', p: 3 });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/artist/abc/setlists', {
      query: { p: 3 },
    });
  });
});
