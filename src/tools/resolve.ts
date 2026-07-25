import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textResult, isoToDmy, createThrottle, ApiError } from '@chrischall/mcp-utils';
import type { SetlistClient } from '../client.js';
import { ATTRIBUTION_NOTE } from '../attribution.js';

const MAX_BATCH = 24;
// Pace upstream calls to ~2 req/sec (setlist.fm's standard-tier limit). Bursting
// a whole batch trips the limit → 429s → retries stack up → the tool call times
// out; spacing the requests keeps the batch steady and predictable.
const PACE_MS = 500;
// Overall wall-clock budget for one tool call. When it's exhausted, the
// remaining concerts come back `pending` instead of timing the whole call out.
const BUDGET_MS = 45_000;

type Query = Record<string, string | undefined>;
type RequestFn = <T>(method: string, path: string, opts?: { query?: Query }) => Promise<T>;

export interface ResolveDeps {
  /**
   * Upstream request function. Required — the caller (the registrar, or a test)
   * supplies it, threading in whichever {@link SetlistClient} it holds. Keeping
   * the client out of this module is what makes the tool transport-neutral: the
   * stdio path passes the env-configured singleton, a hosted per-user deployment
   * passes a client built with that user's injected key.
   */
  request: RequestFn;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  paceMs?: number;
  budgetMs?: number;
  /** Offer a same-tour reference setlist for empty stubs (default true). */
  tourFallback?: boolean;
}

interface RawSetlist {
  id?: string;
  url?: string;
  eventDate?: string;
  artist?: { name?: string; mbid?: string };
  venue?: { name?: string; city?: { name?: string } };
  tour?: { name?: string };
  sets?: { set?: { song?: { name?: string }[] }[] };
}

// A populated setlist from elsewhere on the same tour, offered when this show is
// an empty stub. Clearly NOT this exact show — labeled with its real source date.
interface TourReference {
  note: string;
  tour: string;
  fromDate?: string;
  fromVenue?: string;
  fromCity?: string;
  setlistId?: string;
  url?: string;
  songCount: number;
  songs: string[];
}

interface Concert {
  artist: string;
  date: string;
  city?: string;
  venue?: string;
}

function songCountOf(s: RawSetlist): number {
  const sets = Array.isArray(s.sets?.set) ? s.sets!.set! : [];
  return sets.reduce((n, set) => n + (Array.isArray(set?.song) ? set.song.length : 0), 0);
}

function songNamesOf(s: RawSetlist): string[] {
  const sets = Array.isArray(s.sets?.set) ? s.sets!.set! : [];
  const names: string[] = [];
  for (const set of sets) {
    for (const song of Array.isArray(set?.song) ? set.song : []) {
      if (typeof song?.name === 'string') names.push(song.name);
    }
  }
  return names;
}

// Absolute day distance between two ISO dates; Infinity if either is unparseable.
function daysApart(isoA?: string, isoB?: string): number {
  const a = isoA ? Date.parse(isoA) : NaN;
  const b = isoB ? Date.parse(isoB) : NaN;
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / 86_400_000;
}

// Loosen punctuation/format variants for a fuzzy retry: drop quotes, turn + / &
// into "and", drop stray periods, collapse whitespace. (Dan + Shay, "Weird Al"
// Yankovic, DJ Pee .Wee.)
function normalizeArtist(name: string): string {
  return name
    .replace(/["'’‘”“]/g, '')
    .replace(/\s*[+&]\s*/g, ' and ')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// A no-match search returns HTTP 404 from setlist.fm — treat that as "empty",
// not an error; let anything else propagate. Detected from ApiError's real
// `.status` (never the message, which can echo a body mentioning "404").
async function emptyOn404<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return fallback;
    throw err;
  }
}

async function searchSetlists(req: RequestFn, query: Query): Promise<RawSetlist[]> {
  return emptyOn404(async () => {
    const data = await req<{ setlist?: RawSetlist[] }>('GET', '/1.0/search/setlists', { query });
    return data?.setlist ?? [];
  }, []);
}

async function topArtistMbid(req: RequestFn, artistName: string): Promise<string | undefined> {
  return emptyOn404(async () => {
    const data = await req<{ artist?: { mbid?: string }[] }>('GET', '/1.0/search/artists', {
      query: { artistName, sort: 'relevance' },
    });
    return data?.artist?.[0]?.mbid;
  }, undefined);
}

function score(s: RawSetlist, city?: string, venue?: string): number {
  let sc = 0;
  const vn = s.venue?.name?.toLowerCase() ?? '';
  const cn = s.venue?.city?.name?.toLowerCase() ?? '';
  if (venue && vn.includes(venue.toLowerCase())) sc += 4;
  if (city && cn.includes(city.toLowerCase())) sc += 2;
  if (songCountOf(s) > 0) sc += 1;
  return sc;
}

function pickBest(list: RawSetlist[], city?: string, venue?: string): RawSetlist | undefined {
  if (list.length === 0) return undefined;
  // Best location/song score wins; prefer a populated setlist on ties via songCount.
  return [...list].sort((a, b) => score(b, city, venue) - score(a, city, venue) || songCountOf(b) - songCountOf(a))[0];
}

interface ResolveResult {
  input: Concert;
  match: {
    setlistId?: string;
    url?: string;
    eventDate?: string;
    artist?: string;
    venue?: string;
    city?: string;
    tour?: string;
    songCount: number;
    hasSongs: boolean;
  } | null;
  alternatives: number;
  tourReference?: TourReference;
  pending?: boolean;
}

// When a show is an empty stub but the act toured a repeating set, find a
// populated setlist from the SAME tour (setlist.fm only) to offer as a labeled
// reference. Picks the populated date closest to the show. Returns undefined if
// the stub has no tour or no other populated tour date exists.
async function findTourReference(
  req: RequestFn,
  stub: RawSetlist,
  targetDate: string,
): Promise<TourReference | undefined> {
  const tour = stub.tour?.name;
  if (!tour) return undefined;
  const query: Query = stub.artist?.mbid
    ? { artistMbid: stub.artist.mbid, tourName: tour }
    : { artistName: stub.artist?.name, tourName: tour };
  // Without an artist, a tour-name-only search could return a different act on a
  // same-named tour — don't guess.
  if (!query.artistMbid && !query.artistName) return undefined;
  const candidates = (await searchSetlists(req, query)).filter(
    (s) => s.id !== stub.id && songCountOf(s) > 0,
  );
  if (candidates.length === 0) return undefined;
  // Prefer a *representative* night: a setlist that's substantially complete
  // relative to the tour's best-documented show (≥60%), so we don't surface
  // another thin/partial entry just because it's the nearest date. Among those,
  // pick the date closest to the target show.
  // The best-documented night always passes its own threshold, so `substantial`
  // is non-empty whenever `candidates` is.
  const maxSongs = Math.max(...candidates.map(songCountOf));
  const substantial = candidates.filter((s) => songCountOf(s) >= Math.max(1, maxSongs * 0.6));
  const ref = [...substantial].sort(
    (a, b) => daysApart(a.eventDate, targetDate) - daysApart(b.eventDate, targetDate) || songCountOf(b) - songCountOf(a),
  )[0];
  return {
    note: `No songs are logged for this show on setlist.fm. This is the typical set for the "${tour}" tour, from a different date — verify before treating it as this exact show's setlist.`,
    tour,
    fromDate: ref.eventDate,
    fromVenue: ref.venue?.name,
    fromCity: ref.venue?.city?.name,
    setlistId: ref.id,
    url: ref.url,
    songCount: songCountOf(ref),
    songs: songNamesOf(ref),
  };
}

async function resolveOne(req: RequestFn, c: Concert, tourFallback: boolean): Promise<ResolveResult> {
  const filters: Query = {
    date: isoToDmy(c.date),
    ...(c.city ? { cityName: c.city } : {}),
    ...(c.venue ? { venueName: c.venue } : {}),
  };

  let list = await searchSetlists(req, { artistName: c.artist, ...filters });

  // Fuzzy fallback 1: resolve the artist via the (more forgiving) relevance
  // search, then query by its mbid.
  if (list.length === 0) {
    const mbid = await topArtistMbid(req, c.artist);
    if (mbid) list = await searchSetlists(req, { artistMbid: mbid, ...filters });
  }
  // Fuzzy fallback 2: a punctuation-normalized name.
  if (list.length === 0) {
    const norm = normalizeArtist(c.artist);
    if (norm && norm.toLowerCase() !== c.artist.toLowerCase()) {
      list = await searchSetlists(req, { artistName: norm, ...filters });
    }
  }

  const best = pickBest(list, c.city, c.venue);
  if (!best) return { input: c, match: null, alternatives: 0 };

  const songCount = songCountOf(best);
  const result: ResolveResult = {
    input: c,
    match: {
      setlistId: best.id,
      url: best.url,
      eventDate: best.eventDate, // already ISO (normalized by client.request)
      artist: best.artist?.name,
      venue: best.venue?.name,
      city: best.venue?.city?.name,
      tour: best.tour?.name,
      songCount,
      hasSongs: songCount > 0,
    },
    alternatives: list.length - 1,
  };
  // Empty stub: try to offer the tour's typical (populated) setlist as a labeled reference.
  if (songCount === 0 && tourFallback) {
    const ref = await findTourReference(req, best, c.date);
    if (ref) result.tourReference = ref;
  }
  return result;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve each concert sequentially, pacing upstream calls to stay under
 * setlist.fm's rate limit and stopping (remaining → `pending`) once the
 * wall-clock budget is spent, so a large batch returns partial results instead
 * of timing the whole call out. Exported for testing.
 */
export async function resolveConcerts(concerts: Concert[], deps: ResolveDeps): Promise<ResolveResult[]> {
  const baseRequest: RequestFn = deps.request;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const paceMs = deps.paceMs ?? PACE_MS;
  const budgetMs = deps.budgetMs ?? BUDGET_MS;
  const tourFallback = deps.tourFallback ?? true;

  // Gate every upstream call to at least `paceMs` apart (the first runs
  // immediately). The serialized throttle queue means even concurrent callers
  // can't burst past the spacing.
  const throttle = createThrottle({ minIntervalMs: paceMs, now, sleep });
  const req: RequestFn = (method, path, opts) => throttle(() => baseRequest(method, path, opts));

  const start = now();
  const results: ResolveResult[] = [];
  let budgetSpent = false;
  for (const c of concerts) {
    if (budgetSpent || now() - start >= budgetMs) {
      budgetSpent = true;
      results.push({ input: c, match: null, alternatives: 0, pending: true });
      continue;
    }
    results.push(await resolveOne(req, c, tourFallback));
  }
  return results;
}

/** Build the tool payload (results + summary, plus a note when work was deferred). */
export function summarizeResults(results: ResolveResult[]): Record<string, unknown> {
  const pending = results.filter((r) => r.pending).length;
  const matched = results.filter((r) => r.match).length;
  const stubs = results.filter((r) => r.match && !r.match.hasSongs).length;
  const tourReferenced = results.filter((r) => r.tourReference).length;
  const summary = {
    total: results.length,
    matched,
    stubs,
    tourReferenced,
    unmatched: results.length - matched - pending,
    pending,
  };
  const payload: Record<string, unknown> = { results, summary };
  if (pending > 0) {
    payload.note = `Reached the time budget after ${results.length - pending} of ${results.length} concerts. Re-call setlist_resolve_concerts with just the ${pending} pending concert(s).`;
  }
  return payload;
}

export function registerResolveTools(server: McpServer, client: SetlistClient): void {
  server.registerTool(
    'setlist_resolve_concerts',
    {
      description:
        "Resolve many concerts to their setlists in ONE call (instead of 2+ per show). Given up to 24 `{artist, date, city?, venue?}`, returns the best-match setlist for each — `{setlistId, url, eventDate, artist, venue, city, tour, songCount, hasSongs}` — plus a `{matched, stubs, tourReferenced, unmatched, pending}` summary. For each: searches artist + date (narrowed by your city/venue), and on a miss falls back to a relevance artist lookup (by mbid) and a punctuation-normalized name so format variants still resolve. `hasSongs: false` flags an empty stub page (no songs logged on setlist.fm). When a show is a stub, if the act toured a repeating set the result also includes a `tourReference` — a populated setlist from the SAME tour on a different date (with `songs` + its own `url`), clearly labeled as a reference, NOT this exact show (set `tourFallback: false` to skip these extra lookups). Calls are paced to setlist.fm's ~2 req/sec limit; if a big batch can't finish within the time budget the rest come back `pending: true` (re-call with just those) rather than timing out. Keep batches ≤24." +
        ATTRIBUTION_NOTE,
      annotations: { readOnlyHint: true },
      inputSchema: {
        concerts: z
          .array(
            z.object({
              artist: z.string().describe('Artist name'),
              date: z.string().describe('Event date, ISO yyyy-MM-dd (e.g. 2025-08-28)'),
              city: z.string().optional().describe('City to disambiguate multi-city dates (optional)'),
              venue: z.string().optional().describe('Venue to disambiguate (optional)'),
            }),
          )
          .min(1)
          .max(MAX_BATCH)
          .describe(`Concerts to resolve (1–${MAX_BATCH} per call)`),
        tourFallback: z
          .boolean()
          .optional()
          .describe('For empty stubs, also fetch a same-tour reference setlist (default true). Set false to skip the extra lookups.'),
      },
    },
    async ({ concerts, tourFallback }) => {
      const results = await resolveConcerts(concerts, {
        tourFallback,
        request: (m, p, o) => client.request(m, p, o),
      });
      return textResult(summarizeResults(results));
    },
  );
}
