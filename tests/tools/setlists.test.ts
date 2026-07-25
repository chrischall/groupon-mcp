import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { client } from '../../src/client.js';
import { registerSetlistTools } from '../../src/tools/setlists.js';
import { createTestHarness } from '../helpers.js';

const mockRequest = vi.spyOn(client, 'request').mockResolvedValue(undefined as never);
let harness: Awaited<ReturnType<typeof createTestHarness>>;

beforeEach(() => mockRequest.mockClear());
afterAll(async () => {
  if (harness) await harness.close();
});

describe('setlist tools', () => {
  it('setup', async () => {
    harness = await createTestHarness((server) => registerSetlistTools(server, client));
  });

  it('setlist_search_setlists forwards the provided filters as query', async () => {
    mockRequest.mockResolvedValue({ setlist: [] });
    await harness.callTool('setlist_search_setlists', {
      artistName: 'Phish',
      year: 2023,
      date: '2023-08-07',
    });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/search/setlists', {
      query: { artistName: 'Phish', year: 2023, date: '07-08-2023' },
    });
  });

  it('converts an ISO lastUpdated date to the API yyyyMMddHHmmss filter', async () => {
    mockRequest.mockResolvedValue({ setlist: [] });
    await harness.callTool('setlist_search_setlists', {
      artistName: 'Phish',
      lastUpdated: '2025-01-31',
    });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/search/setlists', {
      query: { artistName: 'Phish', lastUpdated: '20250131000000' },
    });
  });

  it('normalizes an ISO date (YYYY-MM-DD) to the API dd-MM-yyyy format', async () => {
    mockRequest.mockResolvedValue({ setlist: [] });
    await harness.callTool('setlist_search_setlists', { artistName: 'Oasis', date: '2025-08-28' });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/search/setlists', {
      query: { artistName: 'Oasis', date: '28-08-2025' },
    });
  });

  it('passes a dd-MM-yyyy date through unchanged', async () => {
    mockRequest.mockResolvedValue({ setlist: [] });
    await harness.callTool('setlist_search_setlists', { artistName: 'Oasis', date: '28-08-2025' });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/search/setlists', {
      query: { artistName: 'Oasis', date: '28-08-2025' },
    });
  });

  it('setlist_get_setlist hits /1.0/setlist/{id}', async () => {
    mockRequest.mockResolvedValue({ id: '63de4613' });
    const result = await harness.callTool('setlist_get_setlist', { setlistId: '63de4613' });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/setlist/63de4613');
    expect((result.content[0] as { text: string }).text).toContain('63de4613');
  });

  it('setlist_get_setlist_version hits /1.0/setlist/version/{id}', async () => {
    mockRequest.mockResolvedValue({ versionId: 'g635bf3' });
    await harness.callTool('setlist_get_setlist_version', { versionId: 'g635bf3' });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/setlist/version/g635bf3');
  });
});
