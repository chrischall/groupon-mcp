// Invariant: every `// x-release-please-version` annotation in src/ must hold a
// version string equal to package.json's `version`. The walk/assert is the
// shared `versionSyncTest` from `@chrischall/mcp-utils/test`.
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionSyncTest } from '@chrischall/mcp-utils/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('version sync', () => {
  it('every `x-release-please-version` annotation matches package.json', () => {
    const mismatches = versionSyncTest({
      srcDir: join(ROOT, 'src'),
      pkgPath: join(ROOT, 'package.json'),
    });
    expect(mismatches, mismatches.join('\n')).toEqual([]);
  });
});
