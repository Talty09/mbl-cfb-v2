import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';
import type { Env } from '../types';

/**
 * A Drizzle client over the request's D1 binding.
 *
 * Cheap to construct — it's a thin wrapper, not a connection pool — so it's
 * built per request rather than cached in module scope. Module-level state is
 * shared across requests in the same isolate and is a footgun on Workers.
 */
export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
