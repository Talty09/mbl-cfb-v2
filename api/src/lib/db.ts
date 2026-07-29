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

/**
 * D1 caps bound parameters per statement, so a single multi-row INSERT of the
 * ~135 FBS teams or a week of games would be rejected. Conservative on purpose:
 * being under the real ceiling only costs extra statements, while being over it
 * fails the whole ingest slice.
 */
export const D1_MAX_BOUND_PARAMS = 100;

/**
 * Insert in chunks sized so each statement stays within the parameter budget.
 *
 * Sequential rather than batched: the free plan also caps queries per Worker
 * invocation (50), and awaiting each chunk keeps the count visible and bounded
 * instead of hidden inside a batch.
 */
export async function insertChunked<T>(
  rows: T[],
  columnsPerRow: number,
  insert: (chunk: T[]) => Promise<unknown>,
): Promise<{ rows: number; statements: number }> {
  if (rows.length === 0) return { rows: 0, statements: 0 };

  const perChunk = Math.max(1, Math.floor(D1_MAX_BOUND_PARAMS / Math.max(1, columnsPerRow)));
  let statements = 0;

  for (let i = 0; i < rows.length; i += perChunk) {
    await insert(rows.slice(i, i + perChunk));
    statements += 1;
  }

  return { rows: rows.length, statements };
}
