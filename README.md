# groupon-mcp

[![CI](https://github.com/chrischall/groupon-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/chrischall/groupon-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/groupon-mcp)](https://www.npmjs.com/package/groupon-mcp)
[![license](https://img.shields.io/npm/l/groupon-mcp)](LICENSE)

MCP server for [Groupon](https://www.groupon.com) — search and browse local, goods, and travel deals from Claude via natural language.

> This project was developed and is maintained by AI. Use at your own discretion.

## Status

Early read-path MVP. Deal-read tools (search and browse over Groupon's public consumer endpoint) land in upcoming phases; this release establishes the server skeleton. No API key or account is required to read deals.

## Setup

Add the server to your `.mcp.json`:

```json
{
  "mcpServers": {
    "groupon": {
      "command": "npx",
      "args": ["-y", "groupon-mcp"]
    }
  }
}
```

## Development

```bash
npm install
npm run build   # tsc + esbuild bundle → dist/
npm test        # vitest
```

See [CLAUDE.md](CLAUDE.md) for architecture, conventions, and gotchas.

## License

MIT
