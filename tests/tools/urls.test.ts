import { describe, it, expect, afterAll } from 'vitest';
import { registerUrlTools, extractSetlistId } from '../../src/tools/urls.js';
import { createTestHarness } from '../helpers.js';

describe('extractSetlistId', () => {
  it('extracts the 8-char hex id from a canonical setlist URL', () => {
    expect(
      extractSetlistId(
        'https://www.setlist.fm/setlist/elle-king/2024/the-fillmore-charlotte-nc-4ba8a766.html',
      ),
    ).toBe('4ba8a766');
  });

  it('extracts a 7-char hex id (length is not hardcoded)', () => {
    expect(
      extractSetlistId(
        'https://www.setlist.fm/setlist/sammy-hagar/2024/pnc-music-pavilion-charlotte-nc-b56197e.html',
      ),
    ).toBe('b56197e');
  });

  it('strips query string and fragment, and tolerates http + no www', () => {
    expect(
      extractSetlistId('http://setlist.fm/setlist/some-artist/2024/a-venue-356195b.html?foo=bar#x'),
    ).toBe('356195b');
  });

  it('tolerates a missing .html extension', () => {
    expect(
      extractSetlistId('https://www.setlist.fm/setlist/some-artist/2024/a-venue-734a56c1'),
    ).toBe('734a56c1');
  });

  it('tolerates a trailing slash', () => {
    expect(
      extractSetlistId('https://www.setlist.fm/setlist/some-artist/2024/a-venue-734a56c1/'),
    ).toBe('734a56c1');
  });

  it('rejects an artist (/setlists/) page URL', () => {
    expect(() =>
      extractSetlistId('https://www.setlist.fm/setlists/the-black-crowes-3d69da7.html'),
    ).toThrow(/setlist/i);
  });

  it('rejects a venue (/venue/) page URL', () => {
    expect(() =>
      extractSetlistId(
        'https://www.setlist.fm/venue/truliant-ampitheater-charlotte-nc-usa-63dfbe8b.html',
      ),
    ).toThrow(/setlist/i);
  });

  it('rejects a URL with no parseable id', () => {
    expect(() => extractSetlistId('https://www.setlist.fm/setlist/')).toThrow();
  });
});

describe('setlist_id_from_url tool', () => {
  let harness: Awaited<ReturnType<typeof createTestHarness>>;
  afterAll(async () => {
    if (harness) await harness.close();
  });
  const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

  it('setup', async () => {
    harness = await createTestHarness((s) => registerUrlTools(s));
  });

  it('returns { setlistId } for a valid setlist URL', async () => {
    const out = parse(
      await harness.callTool('setlist_id_from_url', {
        url: 'https://www.setlist.fm/setlist/elle-king/2024/the-fillmore-charlotte-nc-4ba8a766.html',
      }),
    );
    expect(out).toEqual({ setlistId: '4ba8a766' });
  });

  it('errors on a non-setlist URL', async () => {
    const res = await harness.callTool('setlist_id_from_url', {
      url: 'https://www.setlist.fm/venue/truliant-ampitheater-charlotte-nc-usa-63dfbe8b.html',
    });
    expect(res.isError).toBeTruthy();
  });
});
