import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { ApiError, SessionResponse } from 'shared';
import { loginRequestSchema } from 'shared/requests';
import { sessions, users } from '../db/schema';
import { getDb } from '../lib/db';
import { verifyPassword } from '../lib/password';
import {
  createSession,
  revokeSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from '../lib/session';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

export const authRoutes = new Hono<AppEnv>();

/**
 * Cookie attributes.
 *
 * - httpOnly: script can't read the token, so an XSS bug can't exfiltrate it.
 *   This is the main reason for a cookie over localStorage.
 * - sameSite Lax: the app is a same-origin SPA and never needs the cookie on
 *   cross-site POSTs, which also means we don't need CSRF tokens for `Lax`
 *   to protect state-changing requests.
 * - secure: set whenever the request isn't plain-http localhost, so `wrangler
 *   dev` over http still works while production is always Secure.
 */
function sessionCookieOptions(requestUrl: string) {
  const url = new URL(requestUrl);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return {
    httpOnly: true,
    secure: url.protocol === 'https:' || !isLocalhost,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

authRoutes.post('/auth/login', async (c) => {
  const parsed = loginRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json<ApiError>({ error: 'Enter your username and password.' }, 400);
  }
  const { username, password } = parsed.data;

  const db = getDb(c.env);
  const user = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
      avatarHue: users.avatarHue,
      isCommissioner: users.isCommissioner,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.username, username))
    .get();

  // No dummy hash on the unknown-username path. That defence is against
  // account enumeration, and this private league publicly lists its competitors
  // by name — there is little to enumerate. Skipping it also keeps a failed login
  // well clear of the 10 ms CPU ceiling.
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    return c.json<ApiError>({ error: 'Invalid username or password.' }, 401);
  }

  const { token } = await createSession(db, user.id);
  setCookie(c, SESSION_COOKIE, token, sessionCookieOptions(c.req.url));

  const { passwordHash: _passwordHash, ...sessionUser } = user;
  return c.json<SessionResponse>({ user: sessionUser });
});

authRoutes.post('/auth/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await revokeSession(getDb(c.env), token);
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  // Idempotent: signing out when already signed out is success, not an error.
  return c.json<SessionResponse>({ user: null });
});

/** Who am I? Returns `{ user: null }` for guests — see SessionResponse. */
authRoutes.get('/auth/me', (c) => {
  return c.json<SessionResponse>({ user: c.get('user') ?? null });
});

/**
 * Revoke every session for the signed-in manager, including this one. Useful if
 * a passphrase leaks and the commissioner reissues it.
 */
authRoutes.post('/auth/logout-everywhere', requireAuth, async (c) => {
  const user = c.get('user')!;
  await getDb(c.env).delete(sessions).where(eq(sessions.userId, user.id));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json<SessionResponse>({ user: null });
});
