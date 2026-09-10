declare module '*.csv?raw' {
  const content: string;
  export default content;
}

/**
 * Tests see the Worker's own bindings plus the migration list that
 * vitest.config.ts injects (see the note there on why it can't be read from
 * inside a test), so declare it on the generated env rather than casting at
 * every use.
 */
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers').D1Migration[];
  }
}
