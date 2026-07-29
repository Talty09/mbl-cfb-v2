import type { SessionUser } from 'shared';

/**
 * Worker bindings.
 *
 * Generated from wrangler.jsonc by `npm run cf-typegen`, which writes
 * worker-configuration.d.ts at the repo root (committed, so typechecking and CI
 * don't need to run wrangler first). Aliasing rather than hand-writing the shape
 * means the bindings cannot drift from the config that actually provisions them —
 * and it's the type `cloudflare:test` hands to integration tests.
 *
 * Rerun `npm run cf-typegen` after changing bindings or vars.
 */
export type Env = Cloudflare.Env;

/** Hono generic parameter, with the authenticated manager attached by middleware. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    /**
     * Set by `attachSession`; absent for guests, who get read-only access.
     * Uses `shared`'s SessionUser so the value here and the one on the wire
     * cannot drift apart.
     */
    user?: SessionUser;
  };
}
