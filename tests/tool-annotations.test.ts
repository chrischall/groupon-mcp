import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { client } from '../src/client.js';
import { webClient } from '../src/web-client.js';
import { registerHealthcheckTools } from '../src/tools/healthcheck.js';
import { registerDealTools } from '../src/tools/deals.js';
import { registerDetailTools } from '../src/tools/detail.js';
import { registerCartTools } from '../src/tools/cart.js';
import { createTestHarness } from './helpers.js';

/**
 * Fleet annotation meta-test (modelled on skylight-mcp). It reads the SERVED
 * tools/list rather than a hand-kept list, so a tool added without a decision
 * fails here instead of shipping with the spec defaults.
 *
 * `destructiveHint` DEFAULTS TO TRUE whenever readOnlyHint is not true, so a
 * write that forgets to declare it is published as destructive and nothing
 * else fails: a considered `true` and a forgotten one look identical. Every
 * tool here reaches groupon.com, so each also says `openWorldHint: true`.
 */
interface Ann {
  readOnlyHint?: unknown;
  destructiveHint?: unknown;
  openWorldHint?: unknown;
}

describe('every tool declares its annotations', () => {
  let harness: Awaited<ReturnType<typeof createTestHarness>>;
  let ann: Record<string, Ann | undefined>;

  beforeAll(async () => {
    harness = await createTestHarness((server) => {
      registerHealthcheckTools(server, client);
      registerDealTools(server, client);
      registerDetailTools(server, client);
      registerCartTools(server, webClient, client);
    });
    // harness.listTools() drops annotations; the raw client keeps them.
    const { tools } = await harness.client.listTools();
    ann = Object.fromEntries(tools.map((t) => [t.name, t.annotations as Ann | undefined]));
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  it('covers the full surface (guards against a registrar being dropped here)', () => {
    expect(Object.keys(ann)).toHaveLength(7);
  });

  it('sets an explicit boolean destructiveHint on every write', () => {
    const undeclared = Object.entries(ann)
      .filter(([, a]) => a?.readOnlyHint !== true && typeof a?.destructiveHint !== 'boolean')
      .map(([name]) => name);
    expect(undeclared).toEqual([]);
  });

  it('never lets a read claim to be destructive', () => {
    const contradictory = Object.entries(ann)
      .filter(([, a]) => a?.readOnlyHint === true && a?.destructiveHint === true)
      .map(([name]) => name);
    expect(contradictory).toEqual([]);
  });

  it('sets openWorldHint: true on every tool (each one talks to groupon.com)', () => {
    const notOpen = Object.entries(ann)
      .filter(([, a]) => a?.openWorldHint !== true)
      .map(([name]) => name);
    expect(notOpen).toEqual([]);
  });

  it('keeps both cart writes destructive (no tool here restores the prior cart)', () => {
    // groupon_clear_cart wipes every line, including ones added on groupon.com
    // itself; groupon_purchase may overwrite an existing line's quantity, and
    // the only way to take its line back out is clear_cart, which also wipes
    // everything else. Re-adding depends on each deal still being on offer.
    for (const name of ['groupon_purchase', 'groupon_clear_cart']) {
      expect(ann[name], name).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    }
  });
});
