// setlist.fm search/listing responses embed each setlist's songs in
// `sets.set[].song[]`, but an empty "stub" page (a setlist exists with no songs
// logged) looks identical to a populated one until you inspect it. Annotate
// every setlist object with `songCount` / `setCount` / `hasSongs` so a caller can
// skip stubs (`hasSongs: false`) without a second fetch.
interface SetlistSet {
  song?: unknown[];
}

export function augmentSetlists<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) augmentSetlists(item);
  } else if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sets = obj.sets;
    if (sets !== null && typeof sets === 'object') {
      const raw = (sets as { set?: unknown }).set;
      const list: SetlistSet[] = Array.isArray(raw) ? (raw as SetlistSet[]) : [];
      const songCount = list.reduce((n, s) => n + (Array.isArray(s?.song) ? s.song.length : 0), 0);
      obj.songCount = songCount;
      obj.setCount = list.length;
      obj.hasSongs = songCount > 0;
    }
    for (const key of Object.keys(obj)) augmentSetlists(obj[key]);
  }
  return value;
}
