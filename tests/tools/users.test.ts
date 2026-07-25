import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { client } from '../../src/client.js';
import { registerUserTools } from '../../src/tools/users.js';
import { createTestHarness } from '../helpers.js';

const mockRequest = vi.spyOn(client, 'request').mockResolvedValue(undefined as never);
let harness: Awaited<ReturnType<typeof createTestHarness>>;

beforeEach(() => mockRequest.mockClear());
afterAll(async () => {
  if (harness) await harness.close();
});

describe('user tools', () => {
  it('setup', async () => {
    harness = await createTestHarness((server) => registerUserTools(server, client));
  });

  it('setlist_get_user hits /1.0/user/{userId}', async () => {
    mockRequest.mockResolvedValue({ userId: 'chris' });
    await harness.callTool('setlist_get_user', { userId: 'chris' });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/user/chris');
  });

  it('setlist_get_user_attended passes the page param', async () => {
    mockRequest.mockResolvedValue({ setlist: [] });
    await harness.callTool('setlist_get_user_attended', { userId: 'chris', p: 2 });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/user/chris/attended', {
      query: { p: 2 },
    });
  });

  it('setlist_get_user_edited hits the edited endpoint', async () => {
    mockRequest.mockResolvedValue({ setlist: [] });
    await harness.callTool('setlist_get_user_edited', { userId: 'chris' });
    expect(mockRequest).toHaveBeenCalledWith('GET', '/1.0/user/chris/edited', {
      query: {},
    });
  });
});
