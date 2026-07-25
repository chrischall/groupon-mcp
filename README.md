# setlist-mcp

[![CI](https://github.com/chrischall/setlist-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/chrischall/setlist-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/setlist-mcp)](https://www.npmjs.com/package/setlist-mcp)
[![license](https://img.shields.io/npm/l/setlist-mcp)](LICENSE)

MCP server for [setlist.fm](https://www.setlist.fm) — search concert setlists, artists, venues, tours, and cities from Claude via natural language. Mostly read-only (the setlist.fm REST API exposes no write endpoints), plus authenticated "I was there" attendance actions via your logged-in session.

> This project was developed and is maintained by AI (Claude). Use at your own discretion.

## What it does

Exposes 20 tools — 18 read-only over the [setlist.fm REST API](https://api.setlist.fm/docs/1.0/index.html), plus 2 authenticated "I was there" attendance actions:

| Area | Tools |
|------|-------|
| Artists | `setlist_search_artists`, `setlist_get_artist`, `setlist_get_artist_setlists` |
| Setlists | `setlist_search_setlists`, `setlist_get_setlist`, `setlist_get_setlist_version` |
| Venues | `setlist_search_venues`, `setlist_get_venue`, `setlist_get_venue_setlists` |
| Cities & countries | `setlist_search_cities`, `setlist_get_city`, `setlist_search_countries` |
| Users | `setlist_get_user`, `setlist_get_user_attended`, `setlist_get_user_edited` |
| Resolve | `setlist_resolve_concerts` |
| Attendance (authenticated writes) | `setlist_mark_attended`, `setlist_unmark_attended` |
| Utility | `setlist_healthcheck`, `setlist_id_from_url` |

## Setup

Get a free API key (non-commercial use) at [setlist.fm/settings/api](https://www.setlist.fm/settings/api), then add the server to your `.mcp.json`:

```json
{
  "mcpServers": {
    "setlist": {
      "command": "npx",
      "args": ["-y", "setlist-mcp"],
      "env": {
        "SETLIST_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Optional: `SETLIST_ACCEPT_LANGUAGE` (one of `en, es, fr, de, pt, tr, it, pl`) localizes city/country names.

See [skills/setlist/SKILL.md](skills/setlist/SKILL.md) for from-source setup, the full tool reference, and example flows.

## Attribution & terms

Use is governed by the [setlist.fm API terms](https://www.setlist.fm/help/api-terms). In short:

- **Attribute setlist.fm.** Every result carries a `url`; surface it as a *followable* source link (no `nofollow`) wherever the data is shown. The tool descriptions instruct the model to do this, and results pass the `url` through verbatim.
- **Non-commercial only** under a free key — commercial use requires setlist.fm's permission.
- **No persistent caching** — this server makes a live API call per tool invocation and keeps no datastore. Please don't add one.
- **Keep your API key private** — it lives in `SETLIST_API_KEY` (`.env` is gitignored) and never appears in tool output.

## Development

```bash
npm install
npm run build   # tsc + esbuild bundle → dist/
npm test        # vitest
```

For local runs, put `SETLIST_API_KEY=<key>` in a `.env` file (gitignored) next to the project root.

See [CLAUDE.md](CLAUDE.md) for architecture, conventions, and gotchas.

## License

MIT
