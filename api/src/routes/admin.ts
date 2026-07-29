import { Hono } from 'hono';
import type { ApiError } from 'shared';
import { adminSyncRequestSchema } from 'shared/requests';
import { getDb } from '../lib/db';
import { requireCommissioner } from '../middleware/auth';
import { runIngestSlice } from '../services/ingest';
import type { AppEnv } from '../types';

export const adminRoutes = new Hono<AppEnv>();

/**
 * Force an ingest slice instead of waiting for the cron.
 *
 * Commissioner-only, and useful in two situations: pulling results immediately
 * after a game finishes, and re-running a stage that `/api/meta` reports as
 * failing. `force` bypasses the season-window check so it also works in the
 * offseason.
 */
adminRoutes.post('/admin/sync', requireCommissioner, async (c) => {
  const parsed = adminSyncRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json<ApiError>({ error: 'Unknown sync slice requested' }, 400);
  }

  try {
    const outcome = await runIngestSlice(getDb(c.env), c.env, {
      force: parsed.data.slice ?? 'calendar',
    });
    return c.json(outcome);
  } catch (error) {
    // Surface the real reason — the commissioner asked for this explicitly, and
    // "CFBD returned 429" is far more useful than a generic failure.
    const message = error instanceof Error ? error.message : String(error);
    return c.json<ApiError>({ error: message }, 502);
  }
});
