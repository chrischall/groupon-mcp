import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
// SDK v2 imports zod/v4 as ESM, whose class initialization is broken when
// bundled directly by esbuild. Resolve the CommonJS export through Node so the
// alias follows zod's exports map and works with hoisted or nested installs.
const zodV4Cjs = require.resolve('zod/v4');

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['dotenv'],
  alias: { 'zod/v4': zodV4Cjs },
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
  outfile: 'dist/bundle.js',
});
