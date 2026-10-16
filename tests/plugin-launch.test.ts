// Invariant: the Claude Code plugin launches the published npm package. A
// git-source plugin install (chrischall/mcp-marketplace) never builds the
// repo, so a .mcp.json that points at the gitignored dist/ fails to start.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string;
};
const config = JSON.parse(readFileSync(new URL('../.mcp.json', import.meta.url), 'utf8')) as {
  mcpServers: Record<string, { command: string; args: string[] }>;
};

describe('plugin .mcp.json launch', () => {
  it('runs the published package with npx instead of a dist/ path', () => {
    const servers = Object.values(config.mcpServers);
    expect(servers).toHaveLength(1);
    const [server] = servers;
    expect(server).toMatchObject({ command: 'npx', args: ['-y', pkg.name] });
  });
});
