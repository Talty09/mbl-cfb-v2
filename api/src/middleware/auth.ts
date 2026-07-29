import { deleteCookie, getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { ApiError } from 'shared';
import { getDb } from '../lib/db';
import { resolveSession, SESSION_COOKIE } from '../lib/session';
import type { AppEnv } from '../types';

/**
 * Resolve the session cookie onto `c.var.user`, if there is one.
 *
 * Runs on every API request and never rejects: read views are public per the
 * design handoff, so "no session" is a normal state, not an error. Only writes
 * are gated, by `requireAuth` below.
 */
export const attachSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);

  if (token) {
    const user = await resolveSession(getDb(c.env), token);
    if (user) {
      c.set('user', user);
    } else {
      // Expired or revoked: clear it so the browser stops sending it and the
      // client stops believing it is signed in.
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
    }
  }

  await next();
});

/** Gate write actions — drafting and posting to chat. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('user')) {
    return c.json<ApiError>({ error: 'Sign in to do that' }, 401);
  }
  await next();
});

/**
 * Gate commissioner actions: setting the draft order, opening and closing the
 * draft, picking on someone's behalf, forcing an ingest.
 *
 * 403 rather than 401 — the caller is authenticated, just not allowed.
 */
export const requireCommissioner = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user) {
    return c.json<ApiError>({ error: 'Sign in to do that' }, 401);
  }
  if (!user.isCommissioner) {
    return c.json<ApiError>({ error: 'Commissioner only' }, 403);
  }
  await next();
});
