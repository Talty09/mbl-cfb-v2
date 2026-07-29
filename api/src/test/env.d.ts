import type { D1Migration } from '@cloudflare/vitest-pool-workers';

/**
 * Tests see the Worker's own bindings plus the migration list that
 * vitest.config.ts injects (see the note there on why it can't be read from
 * inside a test), so declare it on the generated env rather than casting at
 * every use.
 */
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
