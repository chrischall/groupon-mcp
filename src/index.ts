#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION } from './version.js';
import { client } from './client.js';
import { registerHealthcheckTools } from './tools/healthcheck.js';
import { registerDealTools } from './tools/deals.js';

// Read-path MVP. This phase establishes the Groupon identity and a minimal,
// read-only stdio MCP server: a dependency-free healthcheck plus the deal
// search/browse tool backed by the consumer GraphQL endpoint (BrowseDealFeed).
// Purchase / cookie / connector paths arrive in later phases.
await runMcp({
  name: 'groupon-mcp',
  version: VERSION,
  banner:
    '[groupon-mcp] This project was developed and is maintained by AI. Use at your own discretion.',
  tools: [registerHealthcheckTools, (server) => registerDealTools(server, client)],
});
