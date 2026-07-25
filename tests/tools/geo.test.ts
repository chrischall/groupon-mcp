import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { client } from '../../src/client.js';
import { registerGeoTools } from '../../src/tools/geo.js';
import { createTestHarness } from '../helpers.js';

const mockRequest = vi.spyOn(client, 'request').mockResolvedValue(undefined as never);
let harness: Awaited<ReturnType<typeof createTestHarness>>;

beforeEach(() => mockRequest.mockClear());
afterAll(async () => {
  if (harness) await harness.close();
});

describe('geo tools', () => {
  it('setup', async () => {
    harness = await createTestHarness((server) => registerGeoTools(server, client));
  });

  it('setlist_search_cities forwards filters as query', async () => {
    mockRequest.mockResolvedValue({ cities: [] });
    await harness.callTool('setlist_search_cities', { name: 'Berlin', country: 'Germany' });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/search/cities', {
      query: { name: 'Berlin', country: 'Germany' },
    });
  });

  it('setlist_get_city hits /1.0/city/{geoId}', async () => {
    mockRequest.mockResolvedValue({ id: '5128581' });
    await harness.callTool('setlist_get_city', { geoId: '5128581' });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/city/5128581');
  });

  it('setlist_search_countries takes no params', async () => {
    mockRequest.mockResolvedValue({ country: [] });
    await harness.callTool('setlist_search_countries', {});
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/search/countries');
  });
});
