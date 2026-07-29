import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * Tests run inside workerd, not Node. That matters here: `crypto.subtle`, D1
 * bindings, and the request/response objects are the real ones, so a passing
 * test cannot be passing for a reason that won't hold in production.
 *
 * Note the API shape — @cloudflare/vitest-pool-workers 0.19 dropped the
 * `defineWorkersConfig` helper (and its `./config` subpath) in favour of the
 * `cloudflareTest` Vite plugin below. Older examples online still show the old
 * form and will not resolve.
 *
 * The wrangler config is read from the repo root so bindings (DB, ASSETS, vars)
 * stay defined in exactly one place.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: '../wrangler.jsonc' },
    }),
  ],
  resolve: {
    alias: {
      shared: new URL('../shared/src/index.ts', import.meta.url).pathname,
    },
  },
});
