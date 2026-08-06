#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { VERSION } from './version.js';
import { client } from './client.js';
import { webClient } from './web-client.js';
import { registerHealthcheckTools } from './tools/healthcheck.js';
import { registerDealTools } from './tools/deals.js';
import { registerDetailTools } from './tools/detail.js';
import { registerCartTools } from './tools/cart.js';

// The full STDIO server: the anonymous read tools (healthcheck, deal
// search/browse, deal detail, category taxonomy) PLUS the confirm-gated cart /
// purchase path (view / add-to-cart / clear). The cart tools authenticate with
// the user's Groupon session cookie via `webClient`; they resolve deal option
// ids through the anonymous read `client`. Deferred-config: reads still boot
// with no credential — the missing-session error surfaces only on the first
// cart call.
await runMcp({
  name: 'groupon-mcp',
  version: VERSION,
  banner:
    '[groupon-mcp] This project was developed and is maintained by AI. Use at your own discretion.',
  tools: [
    registerHealthcheckTools,
    (server) => registerDealTools(server, client),
    (server) => registerDetailTools(server, client),
    (server) => registerCartTools(server, webClient, client),
  ],
});
