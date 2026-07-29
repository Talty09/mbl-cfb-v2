import { api } from './app';
import { getDb } from './lib/db';
import { runIngestSlice, runMaintenance } from './services/ingest';
import type { Env } from './types';

/**
 * Single Worker: the Angular SPA and the API ship as one deploy.
 *
 * `assets.run_worker_first: ["/api/*"]` means only API paths reach this script
 * — asset requests are answered by the assets binding without invoking the
 * Worker at all, which is what keeps us under the free plan's 100k
 * requests/day. The ASSETS fallback below is defensive, for the case where
 * routing config and code drift apart.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api')) {
      return api.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },

  /**
   * CFBD ingest, every 5 minutes. Handles exactly one slice of work per firing,
   * because a scheduled handler gets the same 10 ms CPU budget as a request.
   *
   * Failures are swallowed here on purpose: the slice already recorded the
   * message in `sync_state.last_error` (surfaced by `/api/meta`), and throwing
   * would only produce a duplicate, less informative cron error.
   */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const db = getDb(env);

    try {
      const outcome = await runIngestSlice(db, env);
      console.log(`ingest ${outcome.stage}: ${outcome.detail}`);
    } catch (error) {
      console.error('ingest slice failed:', error);
    }

    // Housekeeping runs after the slice and outside its error path, so a CFBD
    // outage doesn't stop expired sessions being reaped.
    ctx.waitUntil(
      runMaintenance(db).catch((error: unknown) => {
        console.error('maintenance failed:', error);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
