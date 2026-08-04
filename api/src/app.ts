import { Hono } from 'hono';
import type { ApiError } from 'shared';
import { attachSession } from './middleware/auth';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { chatRoutes } from './routes/chat';
import { draftRoutes } from './routes/draft';
import { leagueRoutes } from './routes/league';
import { metaRoutes } from './routes/meta';
import { pulseRoutes } from './routes/pulse';
import type { AppEnv } from './types';

/**
 * The API. Mounted at /api, which is also the only prefix wrangler routes to
 * the Worker (`assets.run_worker_first` in wrangler.jsonc) — everything else is
 * served straight from the assets binding.
 *
 * There is deliberately no CFBD passthrough here. CFBD is an ingest-time
 * concern only, so no read path depends on a third party being up.
 */
export const api = new Hono<AppEnv>().basePath('/api');

// Resolves the session cookie for every route. It never rejects — read views are
// public, and only the write routes add `requireAuth`.
api.use('*', attachSession);

api.route('/', authRoutes);
api.route('/', metaRoutes);
api.route('/', pulseRoutes);
api.route('/', draftRoutes);
api.route('/', leagueRoutes);
api.route('/', chatRoutes);
api.route('/', adminRoutes);

api.notFound((c) => c.json<ApiError>({ error: 'Not found' }, 404));

api.onError((err, c) => {
  // Surfaced in `wrangler tail` and the dashboard; observability is enabled.
  console.error('Unhandled API error:', err);
  return c.json<ApiError>({ error: 'Internal error' }, 500);
});
