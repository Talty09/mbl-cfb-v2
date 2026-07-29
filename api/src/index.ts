import { api } from './app';
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
   * CFBD ingest. Fires every 5 minutes and handles exactly one slice of work,
   * because a scheduled handler gets the same 10 ms CPU budget as a request —
   * see services/ingest once implemented.
   */
  async scheduled(
    _controller: ScheduledController,
    _env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    // TODO(phase 3): advance one ingest slice from sync_state.
  },
} satisfies ExportedHandler<Env>;
