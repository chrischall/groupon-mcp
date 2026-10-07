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

### Cart sign-in (optional)

Reading deals needs no account. The cart tools (`groupon_view_cart`, `groupon_purchase`, `groupon_clear_cart`) use your signed-in groupon.com session, which the server picks up from your browser through the **ContextMint Bridge** extension:

1. Install ContextMint Bridge from its [releases page](https://github.com/nullnet-app/contextmint-bridge/releases). Chrome: download the Chrome zip, unzip it, and load it unpacked at `chrome://extensions` (Developer mode). Safari isn't available yet (it will ship inside the ContextMint app, which has no public download), so use Chrome for now.

   ContextMint Bridge is the fetchproxy browser extension under its new name, from the same maintainer; fetchproxy's own README (https://github.com/chrischall/fetchproxy#extension) points to it. Its source is public at https://github.com/nullnet-app/contextmint-bridge: build it yourself, or check a release zip against the `.sha256` file published beside it (`shasum -a 256 -c contextmint-bridge-chrome-<version>.zip.sha256`).
2. Sign in at [groupon.com](https://www.groupon.com) in that browser. The first cart call lifts the session cookie; approve the request in the extension when asked.

For local dev without the extension, set `GROUPON_SESSION_COOKIE` (see `.env.example`); set `GROUPON_DISABLE_FETCHPROXY=1` to turn the browser path off.

## Confirmations

The cart writes (`groupon_purchase`, `groupon_clear_cart`) ask you to confirm before they change anything. A client that can show a confirmation prompt (Claude Code) shows one. Elsewhere, the first call changes nothing and returns a preview plus a `confirmToken`, and only a repeat call with that token proceeds. The token is tied to exactly what was previewed: if the deal's price, the chosen option or quantity, or the cart's contents change between the two calls, the write is refused and a fresh preview is returned. `groupon_purchase` still only fills the cart; you complete payment yourself at the checkout URL.

| variable | default | |
|---|---|---|
| `MCP_CONFIRM_MODE` | `ask-user` | What a write does on a client that cannot show a confirmation prompt (claude.ai, Claude Desktop). `ask-user`: two steps — the first call does nothing and returns a preview plus a token, and the model must get your approval in chat before calling again with it. `auto`: the same two steps, but the model may use the token after reviewing the preview itself. `refuse`: writes are refused on such clients. A client that can show prompts (Claude Code) always gets the real prompt, unless `MCP_CONFIRM_ELICITATION=off`. An unrecognised value is treated as `refuse`. |
| `MCP_CONFIRM_ELICITATION` | `on` | `off` never shows a confirmation prompt, so every client gets the `MCP_CONFIRM_MODE` behaviour. Set it for a client that says it can show prompts but never does (the write hangs — opencode 2.0.x). Any other value is treated as `on`, with a warning on stderr. |
| `MCP_CONFIRM_TTL_SECONDS` | `600` | How long a token stays valid. |
| `MCP_CONFIRM_SECRET` | random per process | Signing key; set it only if tokens must survive a server restart. |

## Development

```bash
npm install
npm run build   # tsc + esbuild bundle → dist/
npm test        # tsc typecheck + vitest
```

See [CLAUDE.md](CLAUDE.md) for architecture, conventions, and gotchas.

## License

MIT
