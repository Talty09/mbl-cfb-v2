import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
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
 */

/**
 * Migrations are read here, on the Node side, and handed to the tests as a
 * binding. `readD1Migrations` touches the filesystem, so importing it from a
 * test file fails inside workerd with "No such module node:process".
 */
const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: '../wrangler.jsonc' },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  resolve: {
    // Exact-match regexes, not string prefixes: a string alias for `shared`
    // would also swallow `shared/requests` and resolve it to the barrel.
    alias: [
      {
        find: /^shared\/requests$/,
        replacement: new URL('../shared/src/requests.ts', import.meta.url).pathname,
      },
      {
        find: /^shared$/,
        replacement: new URL('../shared/src/index.ts', import.meta.url).pathname,
      },
    ],
  },
});
