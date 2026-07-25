import { describe, it, expect, beforeAll } from 'vitest';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// End-to-end boot guard. Spawns the REAL built artifacts and confirms they
// answer tools/list — exactly what an MCP host does at install time. Catches an
// eager-import crash in the bundle (no node_modules) and a wrong `bin` path.
//
// The full STDIO server registers the read tools (healthcheck, search, deal
// detail, categories) PLUS the confirm-gated cart path (view / purchase /
// clear) — 7 tools. This asserts the built artifacts boot and list them. The
// cart tools register with no credential (deferred config): the cookie/
// fetchproxy tree is a LAZY import reached only on the first cart CALL, so the
// bundle boots standalone and tools/list succeeds with no session.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'dist', 'bundle.js');
const BIN = join(ROOT, 'dist', 'index.js');

beforeAll(() => {
  if (!existsSync(BUNDLE) || !existsSync(BIN)) {
    execSync('npm run build', { cwd: ROOT, stdio: 'ignore' });
  }
}, 120_000);

/** Spawn an MCP stdio server, run initialize + tools/list, return tool names. */
function listToolsViaStdio(entry: string, cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [entry], {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timed out; stderr:\n${err}`));
    }, 15_000);

    child.stdout.on('data', (d) => {
      out += d.toString();
      for (const line of out.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        let msg: { id?: number; result?: { tools?: { name: string }[] } };
        try {
          msg = JSON.parse(t);
        } catch {
          continue;
        }
        if (msg.id === 1 && msg.result) {
          clearTimeout(timer);
          child.kill('SIGKILL');
          resolve((msg.result.tools ?? []).map((x) => x.name));
          return;
        }
      }
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (out.indexOf('"id":1') === -1) {
        clearTimeout(timer);
        reject(new Error(`server exited (code ${code}) before tools/list; stderr:\n${err}`));
      }
    });

    child.stdin.write(
      '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"boot-test","version":"1"}}}\n',
    );
    child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
  });
}

describe('server boot (built artifacts)', () => {
  it('bundled .mcpb (dist/bundle.js) boots WITHOUT node_modules and lists tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'groupon-mcpb-'));
    try {
      copyFileSync(BUNDLE, join(dir, 'bundle.js'));
      const tools = await listToolsViaStdio(join(dir, 'bundle.js'), dir);
      expect(tools.length).toBeGreaterThanOrEqual(6);
      expect(tools).toContain('groupon_healthcheck');
      expect(tools).toContain('groupon_search_deals');
      expect(tools).toContain('groupon_get_deal');
      expect(tools).toContain('groupon_list_categories');
      expect(tools).toContain('groupon_view_cart');
      expect(tools).toContain('groupon_purchase');
      expect(tools).toContain('groupon_clear_cart');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('npm bin (dist/index.js) boots with node_modules and lists tools', async () => {
    const tools = await listToolsViaStdio(BIN, ROOT);
    expect(tools.length).toBeGreaterThanOrEqual(6);
    expect(tools).toContain('groupon_healthcheck');
    expect(tools).toContain('groupon_search_deals');
    expect(tools).toContain('groupon_get_deal');
    expect(tools).toContain('groupon_list_categories');
    expect(tools).toContain('groupon_view_cart');
    expect(tools).toContain('groupon_purchase');
    expect(tools).toContain('groupon_clear_cart');
  }, 30_000);
});
