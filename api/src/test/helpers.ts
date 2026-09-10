/**
 * Test helpers. These run inside workerd against a real D1 binding, so the
 * migrations must be applied to it first — `env.DB` starts empty in each
 * isolated test database.
 */

import { applyD1Migrations, env } from 'cloudflare:test';
import { getDb } from '../lib/db';
import { hashPassword } from '../lib/password';
import {
  chatMessages,
  draftOrder,
  gamePoints,
  games,
  picks,
  pollRanks,
  seasons,
  sessions,
  syncState,
  teams,
  users,
} from '../db/schema';

export const testEnv = env;

/**
 * Apply the real migration files, so tests exercise the same schema — including
 * the unique indexes that enforce draft exclusivity — that production runs.
 *
 * The migration list arrives as a binding from vitest.config.ts; reading it here
 * would need the filesystem, which workerd doesn't have.
 */
export async function migrate(): Promise<void> {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await reset();
}

/**
 * Empty every table.
 *
 * `isolatedStorage` isolates per test *file*, not per test, so without this a
 * `beforeEach` that seeds the same usernames trips the unique index on the
 * second test. Deletion order respects the foreign keys, which D1 enforces.
 */
export async function reset(): Promise<void> {
  const db = getDb(env);
  await db.delete(sessions);
  await db.delete(chatMessages);
  await db.delete(gamePoints);
  await db.delete(picks);
  await db.delete(draftOrder);
  await db.delete(users);
  await db.delete(seasons);
  await db.delete(games);
  await db.delete(pollRanks);
  await db.delete(teams);
  await db.delete(syncState);
}

export const SEASON = 2026;

export interface SeededManager {
  id: string;
  username: string;
  password: string;
}

/** Insert a season plus managers with known passphrases. */
export async function seedManagers(
  specs: {
    username: string;
    password: string;
    isCommissioner?: boolean;
    /** Defaults to false — most tests want a manager already past the one-time-password gate. */
    mustChangePassword?: boolean;
  }[],
): Promise<SeededManager[]> {
  const db = getDb(testEnv);

  await db
    .insert(seasons)
    .values({ year: SEASON, draftStatus: 'pending', rounds: 10, isCurrent: true })
    .onConflictDoNothing();

  const seeded: SeededManager[] = [];
  for (const spec of specs) {
    const id = `usr_${spec.username.replace(/\./g, '_')}`;
    await db.insert(users).values({
      id,
      username: spec.username,
      displayName: spec.username,
      firstName: spec.username,
      lastName: 'Tester',
      avatarHue: 200,
      isCommissioner: spec.isCommissioner ?? false,
      // A low iteration count keeps the suite fast; the format is identical, and
      // password.test.ts already covers that verification is iteration-agnostic.
      passwordHash: await hashPassword(spec.password, 1_000),
      mustChangePassword: spec.mustChangePassword ?? false,
      createdAt: new Date(),
    });
    seeded.push({ id, username: spec.username, password: spec.password });
  }

  return seeded;
}

/** Pull the session cookie out of a Set-Cookie header for reuse on later requests. */
export function sessionCookieFrom(response: Response): string | null {
  const header = response.headers.get('set-cookie');
  if (!header) return null;
  const match = /mbl_session=([^;]*)/.exec(header);
  if (!match?.[1]) return null;
  return `mbl_session=${match[1]}`;
}
