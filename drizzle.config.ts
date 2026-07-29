import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit only *generates* SQL here — it never connects to D1. Migrations
 * are applied by `wrangler d1 migrations apply`, which is why `migrations_dir`
 * in wrangler.jsonc and `out` below must stay pointed at the same folder.
 */
export default defineConfig({
  dialect: 'sqlite',
  driver: 'd1-http',
  schema: './api/src/db/schema.ts',
  out: './api/migrations',
  verbose: true,
  strict: true,
});
