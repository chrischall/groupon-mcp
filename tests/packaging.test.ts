// Invariant: the Claude Code plugin manifest declares its MCP config under
// `mcpServers` (the key Claude Code reads; `mcp` is ignored at load time), and
// the file it points at exists.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = JSON.parse(
  readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'),
) as Record<string, unknown>;

describe('plugin.json packaging', () => {
  it('declares the MCP config under `mcpServers`, not the ignored `mcp` key', () => {
    expect(plugin).not.toHaveProperty('mcp');
    expect(typeof plugin.mcpServers).toBe('string');
  });

  it('points `mcpServers` at a file that exists', () => {
    expect(existsSync(join(ROOT, plugin.mcpServers as string))).toBe(true);
  });
});
