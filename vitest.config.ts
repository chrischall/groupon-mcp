import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `tests/worker.test.ts` only runs under the Workers runtime pool
    // (`vitest.workers.config.ts` / `npm run worker:test`), which provides the
    // virtual `cloudflare:test` module it imports. Exclude it from the node pool.
    exclude: [...configDefaults.exclude, 'tests/worker.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // The Worker-only entry point imports agents/@chrischall/mcp-connector
      // (cloudflare:workers), which cannot load under the node pool — it is
      // exercised by the Workers pool suite (tests/worker.test.ts via
      // `npm run worker:test`), so exclude it from node-pool coverage.
      exclude: [...configDefaults.coverage.exclude, 'src/worker.ts'],
    },
  },
});
