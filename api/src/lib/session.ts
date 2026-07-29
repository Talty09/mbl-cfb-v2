/**
 * Opaque server-side sessions.
 *
 * Chosen over JWTs deliberately. Verification is one indexed D1 read, which is
 * I/O rather than CPU and so costs nothing against the 10 ms free-plan budget
 * that already constrains password hashing. Revocation is a DELETE instead of a
 * token blocklist, and there is no signing secret to rotate or leak.
 *
 * Only the SHA-256 digest of a token is stored, so a leaked database dump
 * cannot be replayed as a login. A fast hash is correct here — unlike a
 * password, the token is 256 bits of uniform randomness, so there is no
 * dictionary to stretch against.
 */

import { and, eq, gt, lt } from 'drizzle-orm';
import type { SessionUser } from 'shared';
import { sessions, users } from '../db/schema';
import type { Db } from './db';
import { randomBase64Url, sha256Base64Url } from './encoding';

export const SESSION_COOKIE = 'mbl_session';

const TOKEN_BYTES = 32;

/**
 * A year. Long on purpose: managers check in weekly during the season, and an
 * expiry that outlives the season means nobody gets bounced to a login screen
 * mid-draft. Revocation is available if a session ever needs killing.
 */
export const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * `lastSeenAt` is only rewritten once a minute per session. Without this, the
 * draft room polling every 8 seconds would issue a D1 write per poll and burn
 * through the free plan's 100k writes/day for no benefit — a minute of
 * resolution is finer than the two-minute window the online count uses.
 */
const LAST_SEEN_THROTTLE_MS = 60_000;

/** Issue a session and return the raw token — the only time it exists in plaintext. */
export async function createSession(
  db: Db,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBase64Url(TOKEN_BYTES);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await db.insert(sessions).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash: await sha256Base64Url(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  });

  return { token, expiresAt };
}

/**
 * Resolve a token to its manager, or null if the token is unknown or expired.
 * Slides `lastSeenAt`/`expiresAt` forward, throttled per the note above.
 */
export async function resolveSession(db: Db, token: string): Promise<SessionUser | null> {
  const tokenHash = await sha256Base64Url(token);
  const now = new Date();

  const row = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
      avatarHue: users.avatarHue,
      isCommissioner: users.isCommissioner,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    // Expiry is enforced in the query, so an expired row can never authenticate
    // even if the cleanup below has not run.
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .get();

  if (!row) return null;

  if (now.getTime() - row.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
      .where(eq(sessions.id, row.sessionId));
  }

  const { sessionId: _sessionId, lastSeenAt: _lastSeenAt, ...user } = row;
  return user;
}

/** Sign out. Idempotent: an unknown token is a no-op, not an error. */
export async function revokeSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, await sha256Base64Url(token)));
}

/**
 * Drop expired rows. Expiry is already enforced at lookup, so this is only
 * housekeeping to stop the table growing forever — called from the ingest cron.
 */
export async function purgeExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/** Managers seen this recently count as online for the chat header's green dot. */
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;
