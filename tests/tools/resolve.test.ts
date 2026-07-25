import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { ApiError } from '@chrischall/mcp-utils';
import { client } from '../../src/client.js';
import {
  registerResolveTools,
  resolveConcerts,
  summarizeResults,
} from '../../src/tools/resolve.js';
import { createTestHarness } from '../helpers.js';

function setlist(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    url: 'https://www.setlist.fm/x.html',
    eventDate: '2025-08-28',
    artist: { name: 'Oasis' },
    venue: { name: 'Soldier Field', city: { name: 'Chicago' } },
    tour: { name: 'Live 25' },
    sets: { set: [{ song: [{ name: 'a' }, { name: 'b' }] }] },
    ...over,
  };
}

// Inject deps so the core runs instantly and deterministically (no real sleeps,
// no shared-client mock).
const fast = (request: ReturnType<typeof vi.fn>) => ({ request, sleep: async () => {}, paceMs: 0 });

describe('resolveConcerts (core)', () => {
  it('resolves a direct match with song counts', async () => {
    const request = vi.fn(async () => ({ setlist: [setlist()] }));
    const [r] = await resolveConcerts([{ artist: 'Oasis', date: '2025-08-28' }], fast(request));
    expect(r.match).toMatchObject({ setlistId: 's1', songCount: 2, hasSongs: true });
  });

  it('passes the ISO date as dd-MM-yyyy and threads the city filter', async () => {
    const request = vi.fn(async () => ({ setlist: [setlist()] }));
    await resolveConcerts([{ artist: 'TSO', date: '2025-12-13', city: 'Charlotte' }], fast(request));
    const [, path, opts] = request.mock.calls[0];
    expect(path).toBe('/1.0/search/setlists');
    expect((opts as { query: Record<string, unknown> }).query).toMatchObject({
      artistName: 'TSO',
      date: '13-12-2025',
      cityName: 'Charlotte',
    });
  });

  it('flags an empty stub as hasSongs:false', async () => {
    const request = vi.fn(async () => ({ setlist: [setlist({ sets: { set: [] } })] }));
    const [r] = await resolveConcerts([{ artist: 'Xscape', date: '2025-06-01' }], fast(request));
    expect(r.match).toMatchObject({ hasSongs: false, songCount: 0 });
  });

  it('falls back to a relevance artist lookup (mbid) when the direct search misses', async () => {
    const request = vi.fn(async (_m: string, p: string, o?: { query?: Record<string, unknown> }) => {
      const q = o?.query ?? {};
      if (p === '/1.0/search/artists') return { artist: [{ mbid: 'MBID-1' }] };
      if (p === '/1.0/search/setlists' && q.artistMbid === 'MBID-1') return { setlist: [setlist()] };
      return { setlist: [] };
    });
    const [r] = await resolveConcerts([{ artist: 'Dan + Shay', date: '2025-08-28' }], fast(request));
    expect(r.match?.setlistId).toBe('s1');
  });

  it('falls back to a punctuation-normalized name when mbid lookup also misses', async () => {
    const request = vi.fn(async (_m: string, p: string, o?: { query?: Record<string, unknown> }) => {
      const q = o?.query ?? {};
      if (p === '/1.0/search/artists') return { artist: [] };
      if (p === '/1.0/search/setlists' && q.artistName === 'Weird Al Yankovic') return { setlist: [setlist()] };
      return { setlist: [] };
    });
    const [r] = await resolveConcerts([{ artist: '"Weird Al" Yankovic', date: '2025-08-28' }], fast(request));
    expect(r.match?.setlistId).toBe('s1');
  });

  it('treats a 404 (no results) as unmatched, not an error', async () => {
    const request = vi.fn(() =>
      Promise.reject(new ApiError(404, 'setlist.fm error 404 for GET /1.0/search/setlists')),
    );
    const [r] = await resolveConcerts([{ artist: 'Nobody', date: '2025-01-01' }], fast(request));
    expect(r.match).toBeNull();
  });

  it('propagates a non-404 error even when its body mentions 404', async () => {
    const request = vi.fn(() =>
      Promise.reject(new ApiError(500, 'setlist.fm error 500 for GET /1.0/search/setlists: page /404 not cached')),
    );
    await expect(resolveConcerts([{ artist: 'Nobody', date: '2025-01-01' }], fast(request))).rejects.toThrow(/500/);
  });

  it('offers a same-tour reference for an empty stub, picking the closest populated date', async () => {
    const stub = setlist({ id: 'stub1', sets: { set: [] }, tour: { name: 'The Tour' }, artist: { name: 'Dan + Shay', mbid: 'MB' } });
    const far = setlist({ id: 'r1', eventDate: '2024-09-21', venue: { name: 'Fiddlers', city: { name: 'Denver' } }, sets: { set: [{ song: [{ name: 'A' }, { name: 'B' }] }] } });
    const near = setlist({ id: 'r2', eventDate: '2024-08-20', venue: { name: 'Nearby', city: { name: 'Atlanta' } }, sets: { set: [{ song: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }] } });
    const request = vi.fn(async (_m: string, p: string, o?: { query?: Record<string, unknown> }) => {
      const q = o?.query ?? {};
      if (p === '/1.0/search/setlists' && q.tourName) return { setlist: [far, near] };
      if (p === '/1.0/search/setlists') return { setlist: [stub] };
      return {};
    });
    const [r] = await resolveConcerts([{ artist: 'Dan + Shay', date: '2024-08-16' }], fast(request));
    expect(r.match?.hasSongs).toBe(false);
    expect(r.tourReference).toMatchObject({ tour: 'The Tour', fromDate: '2024-08-20', songCount: 3 });
    expect(r.tourReference?.songs).toEqual(['A', 'B', 'C']);
    // The tour lookup used the artist's mbid + tour name.
    const tourCall = request.mock.calls.find((c) => (c[2] as { query?: Record<string, unknown> })?.query?.tourName);
    expect((tourCall![2] as { query: Record<string, unknown> }).query).toMatchObject({ artistMbid: 'MB', tourName: 'The Tour' });
  });

  it('prefers a substantially-complete tour night over a nearer but sparse one', async () => {
    const stub = setlist({ id: 'stub1', sets: { set: [] }, tour: { name: 'T' }, artist: { name: 'A', mbid: 'MB' } });
    const sparseNear = setlist({ id: 'sparse', eventDate: '2024-08-17', sets: { set: [{ song: [{ name: 'x' }, { name: 'y' }] }] } });
    const fullFar = setlist({
      id: 'full',
      eventDate: '2024-08-30',
      sets: { set: [{ song: Array.from({ length: 20 }, (_, i) => ({ name: `s${i}` })) }] },
    });
    const request = vi.fn(async (_m: string, p: string, o?: { query?: Record<string, unknown> }) => {
      const q = o?.query ?? {};
      if (p === '/1.0/search/setlists' && q.tourName) return { setlist: [sparseNear, fullFar] };
      if (p === '/1.0/search/setlists') return { setlist: [stub] };
      return {};
    });
    const [r] = await resolveConcerts([{ artist: 'A', date: '2024-08-16' }], fast(request));
    // sparseNear (2 songs) is the nearest date, but fullFar (20) is representative.
    expect(r.tourReference).toMatchObject({ fromDate: '2024-08-30', songCount: 20 });
  });

  it('adds no tour reference when the stub has no tour or no other populated date', async () => {
    const noTour = setlist({ sets: { set: [] }, tour: undefined });
    const req1 = vi.fn(async (_m: string, p: string, o?: { query?: Record<string, unknown> }) =>
      p === '/1.0/search/setlists' && !(o?.query ?? {}).tourName ? { setlist: [noTour] } : { setlist: [] },
    );
    const [a] = await resolveConcerts([{ artist: 'X', date: '2024-01-01' }], fast(req1));
    expect(a.tourReference).toBeUndefined();
    expect(req1.mock.calls.some((c) => (c[2] as { query?: Record<string, unknown> })?.query?.tourName)).toBe(false);

    // Has a tour, but the tour search returns no other populated date.
    const stub = setlist({ sets: { set: [] }, tour: { name: 'T' } });
    const req2 = vi.fn(async (_m: string, p: string, o?: { query?: Record<string, unknown> }) =>
      p === '/1.0/search/setlists' && (o?.query ?? {}).tourName ? { setlist: [] } : { setlist: [stub] },
    );
    const [b] = await resolveConcerts([{ artist: 'X', date: '2024-01-01' }], fast(req2));
    expect(b.tourReference).toBeUndefined();
  });

  it('does not run a tour search for a stub with no artist info', async () => {
    const noArtist = setlist({ sets: { set: [] }, tour: { name: 'T' }, artist: undefined });
    const request = vi.fn(async (_m: string, p: string, o?: { query?: Record<string, unknown> }) =>
      p === '/1.0/search/setlists' && !(o?.query ?? {}).tourName ? { setlist: [noArtist] } : { setlist: [] },
    );
    const [r] = await resolveConcerts([{ artist: 'X', date: '2024-01-01' }], fast(request));
    expect(r.tourReference).toBeUndefined();
    expect(request.mock.calls.some((c) => (c[2] as { query?: Record<string, unknown> })?.query?.tourName)).toBe(false);
  });

  it('skips the tour lookup entirely when tourFallback is false', async () => {
    const stub = setlist({ sets: { set: [] }, tour: { name: 'T' } });
    const request = vi.fn(async () => ({ setlist: [stub] }));
    const [r] = await resolveConcerts(
      [{ artist: 'X', date: '2024-01-01' }],
      { request, sleep: async () => {}, paceMs: 0, tourFallback: false },
    );
    expect(r.tourReference).toBeUndefined();
    expect(request.mock.calls.some((c) => (c[2] as { query?: Record<string, unknown> })?.query?.tourName)).toBe(false);
  });

  it('paces upstream calls ~paceMs apart (does not burst)', async () => {
    const request = vi.fn(async () => ({ setlist: [setlist()] }));
    const sleep = vi.fn(async () => {});
    await resolveConcerts(
      [
        { artist: 'A', date: '2025-01-01' },
        { artist: 'B', date: '2025-01-02' },
      ],
      { request, sleep, now: () => 1000, paceMs: 500, budgetMs: Infinity },
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1); // first call immediate, second paced
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('stops at the time budget and marks the rest pending (no further upstream calls)', async () => {
    let t = 0;
    const request = vi.fn(async () => {
      t += 1000; // simulate ~1s per resolved concert
      return { setlist: [setlist()] };
    });
    const results = await resolveConcerts(
      [
        { artist: 'A', date: '2025-01-01' },
        { artist: 'B', date: '2025-01-02' },
        { artist: 'C', date: '2025-01-03' },
      ],
      { request, sleep: async (ms) => { t += ms; }, now: () => t, paceMs: 0, budgetMs: 1500 },
    );
    expect(results[0].match).not.toBeNull();
    expect(results[1].match).not.toBeNull();
    expect(results[2].pending).toBe(true);
    expect(request).toHaveBeenCalledTimes(2); // C never hit the API
  });
});

describe('summarizeResults', () => {
  it('counts matched/stubs/tourReferenced/unmatched/pending and adds a note when work was deferred', () => {
    const out = summarizeResults([
      { input: { artist: 'A', date: 'd' }, match: { songCount: 5, hasSongs: true }, alternatives: 0 },
      {
        input: { artist: 'B', date: 'd' },
        match: { songCount: 0, hasSongs: false },
        alternatives: 0,
        tourReference: { note: 'n', tour: 'T', songCount: 3, songs: ['x', 'y', 'z'] },
      },
      { input: { artist: 'C', date: 'd' }, match: null, alternatives: 0 },
      { input: { artist: 'D', date: 'd' }, match: null, alternatives: 0, pending: true },
    ]);
    expect(out.summary).toMatchObject({ total: 4, matched: 2, stubs: 1, tourReferenced: 1, unmatched: 1, pending: 1 });
    expect(String(out.note)).toMatch(/pending/i);
  });

  it('omits the note when nothing is pending', () => {
    const out = summarizeResults([
      { input: { artist: 'A', date: 'd' }, match: { songCount: 1, hasSongs: true }, alternatives: 0 },
    ]);
    expect(out.note).toBeUndefined();
  });
});

describe('setlist_resolve_concerts tool', () => {
  const mockRequest = vi.spyOn(client, 'request').mockResolvedValue(undefined as never);
  let harness: Awaited<ReturnType<typeof createTestHarness>>;
  beforeEach(() => mockRequest.mockClear());
  afterAll(async () => {
    if (harness) await harness.close();
  });
  const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

  it('setup', async () => {
    harness = await createTestHarness((s) => registerResolveTools(s, client));
  });

  it('registers the tool and returns results + summary', async () => {
    mockRequest.mockResolvedValue({ setlist: [setlist()] } as never);
    const out = parse(await harness.callTool('setlist_resolve_concerts', {
      concerts: [{ artist: 'Oasis', date: '2025-08-28' }],
    }));
    expect(out.results[0].match.setlistId).toBe('s1');
    expect(out.summary).toMatchObject({ total: 1, matched: 1 });
  });

  it('rejects a batch larger than 24', async () => {
    const concerts = Array.from({ length: 25 }, (_, i) => ({ artist: `A${i}`, date: '2025-01-01' }));
    const res = await harness
      .callTool('setlist_resolve_concerts', { concerts })
      .catch(() => ({ isError: true }) as { isError: boolean });
    expect(res.isError).toBe(true);
  });
});
