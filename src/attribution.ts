// setlist.fm API terms require a *followable* attribution link wherever their
// data appears (no nofollow): https://www.setlist.fm/help/api-terms. Every
// setlist/artist/venue object carries a `url` (passed through verbatim by
// textResult), so this note — appended to each data tool's description, but not
// to setlist_healthcheck — tells the model to surface that `url` as a source link.
export const ATTRIBUTION_NOTE =
  ' Results include a setlist.fm `url`; when you present this data, cite it as a clickable source link to setlist.fm (their API terms require followable attribution — no nofollow). If a result has no `url`, link to https://www.setlist.fm instead.';
