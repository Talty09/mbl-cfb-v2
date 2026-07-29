/**
 * Worker bindings, declared by hand rather than leaning on `wrangler types` so
 * the contract is reviewable in the diff. Keep in sync with wrangler.jsonc.
 */
export interface Env {
  /** D1 (SQLite). Binding declared under `d1_databases`. */
  DB: D1Database;
  /** Static assets binding — the built Angular SPA. */
  ASSETS: Fetcher;
  /** Season the app operates on, e.g. "2026". A var, not a secret. */
  CURRENT_SEASON: string;
  /** College Football Data API key. A secret; only the ingest reads it. */
  CFBD_API_KEY: string;
}

/** Hono generic parameter, with the authenticated user attached by middleware. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    /** Set by `withSession`; absent for guests, who get read-only access. */
    user?: {
      id: string;
      username: string;
      displayName: string;
      avatarHue: number;
      isCommissioner: boolean;
    };
  };
}
