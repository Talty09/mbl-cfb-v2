import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Pulse } from 'shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { chatMessages, picks, seasons, sessions, syncState, teams } from '../db/schema';
import { getDb } from '../lib/db';
import { CALENDAR_KEY } from '../lib/season';
import { ONLINE_WINDOW_MS } from '../lib/session';
import { attachSession } from '../middleware/auth';
import { migrate, SEASON, seedManagers, testEnv } from '../test/helpers';
import type { AppEnv } from '../types';
import { pulseRoutes } from './pulse';

/** Mounted as app.ts mounts every router — see the note in draft.test.ts. */
const app = new Hono<AppEnv>().basePath('/api');
app.use('*', attachSession);
app.route('/', pulseRoutes);
app.onError((_error, c) => c.json({ error: 'Internal error' }, 500));

const TOM = 'usr_tom';
const ZAC = 'usr_zac';

async function pulse(): Promise<Pulse> {
  const response = await app.fetch(new Request('https://mbl.test/api/pulse'), testEnv);
  expect(response.status).toBe(200);
  return (await response.json()) as Pulse;
}

async function addPick(pickNumber: number, teamId: number, seasonYear = SEASON): Promise<void> {
  const db = getDb(testEnv);
  await db.insert(teams).values({ id: teamId, school: `School ${teamId}` }).onConflictDoNothing();
  await db.insert(picks).values({
    id: `pick_${seasonYear}_${pickNumber}`,
    seasonYear,
    pickNumber,
    userId: TOM,
    teamId,
    madeByUserId: TOM,
    createdAt: new Date(),
  });
}

async function addChat(body: string): Promise<void> {
  await getDb(testEnv)
    .insert(chatMessages)
    .values({ seasonYear: SEASON, userId: TOM, body, createdAt: new Date() });
}

/** A session for `userId`, last seen `agoMs` ago. */
async function addSession(id: string, userId: string, agoMs: number): Promise<void> {
  const seen = new Date(Date.now() - agoMs);
  await getDb(testEnv).insert(sessions).values({
    id,
    userId,
    tokenHash: `hash-${id}`,
    createdAt: seen,
    lastSeenAt: seen,
    expiresAt: new Date(Date.now() + 60_000),
  });
}

describe('GET /api/pulse', () => {
  beforeEach(async () => {
    await migrate();
    await seedManagers([
      { username: 'tom', password: 'tom-pass', isCommissioner: true },
      { username: 'zac', password: 'zac-pass' },
    ]);
  });

  it('is public and reports an untouched season as all zeroes', async () => {
    expect(await pulse()).toEqual({
      pickCount: 0,
      lastChatId: 0,
      lastSyncAt: null,
      currentWeek: null,
      draftStatus: 'pending',
      onlineCount: 0,
    });
  });

  it('counts picks in the current season only', async () => {
    await addPick(1, 2001);
    await addPick(2, 2002);
    expect((await pulse()).pickCount).toBe(2);

    // A prior league year must not inflate this season's counter.
    await getDb(testEnv).insert(seasons).values({ year: SEASON - 1, isCurrent: false });
    await addPick(1, 2003, SEASON - 1);
    expect((await pulse()).pickCount).toBe(2);
  });

  it('tracks the highest chat id, which is the client cursor', async () => {
    expect((await pulse()).lastChatId).toBe(0);

    await addChat('first');
    const afterFirst = (await pulse()).lastChatId;
    expect(afterFirst).toBeGreaterThan(0);

    await addChat('second');
    await addChat('third');
    expect((await pulse()).lastChatId).toBe(afterFirst + 2);
  });

  it('reports the most recent ingest run as epoch ms', async () => {
    const older = new Date('2026-09-01T12:00:00Z');
    const newest = new Date('2026-09-08T18:30:00Z');
    await getDb(testEnv)
      .insert(syncState)
      .values([
        { key: 'games', lastRunAt: older },
        { key: 'rankings', lastRunAt: newest },
        // A stage that has never run must not read as "synced at 0".
        { key: 'points', lastRunAt: null },
      ]);

    expect((await pulse()).lastSyncAt).toBe(newest.getTime());
  });

  it('reads the current week off the calendar cursor', async () => {
    await getDb(testEnv)
      .insert(syncState)
      .values({
        key: CALENDAR_KEY,
        cursor: JSON.stringify({ season: SEASON, week: 7, seasonType: 'regular' }),
        lastRunAt: new Date(),
      });

    expect((await pulse()).currentWeek).toBe(7);
  });

  it('ignores a calendar cursor left behind by another season', async () => {
    await getDb(testEnv)
      .insert(syncState)
      .values({
        key: CALENDAR_KEY,
        cursor: JSON.stringify({ season: SEASON - 1, week: 15, seasonType: 'postseason' }),
      });

    expect((await pulse()).currentWeek).toBeNull();
  });

  it('mirrors the draft status', async () => {
    await getDb(testEnv)
      .update(seasons)
      .set({ draftStatus: 'active' })
      .where(eq(seasons.year, SEASON));
    expect((await pulse()).draftStatus).toBe('active');

    await getDb(testEnv)
      .update(seasons)
      .set({ draftStatus: 'complete' })
      .where(eq(seasons.year, SEASON));
    expect((await pulse()).draftStatus).toBe('complete');
  });

  describe('onlineCount', () => {
    it('counts managers seen inside the window', async () => {
      await addSession('a', TOM, 1_000);
      await addSession('b', ZAC, ONLINE_WINDOW_MS - 5_000);

      expect((await pulse()).onlineCount).toBe(2);
    });

    it('counts a manager with several sessions once', async () => {
      await addSession('phone', TOM, 1_000);
      await addSession('laptop', TOM, 2_000);

      expect((await pulse()).onlineCount).toBe(1);
    });

    it('drops managers who went quiet before the window opened', async () => {
      await addSession('stale', TOM, ONLINE_WINDOW_MS + 60_000);
      await addSession('fresh', ZAC, 1_000);

      expect((await pulse()).onlineCount).toBe(1);
    });
  });

  it('answers every counter in one request', async () => {
    await getDb(testEnv)
      .update(seasons)
      .set({ draftStatus: 'active' })
      .where(eq(seasons.year, SEASON));
    await addPick(1, 2001);
    await addChat('hello');
    await addSession('a', TOM, 1_000);
    await getDb(testEnv)
      .insert(syncState)
      .values({
        key: CALENDAR_KEY,
        cursor: JSON.stringify({ season: SEASON, week: 3, seasonType: 'regular' }),
        lastRunAt: new Date('2026-09-15T00:00:00Z'),
      });

    // Ids come from an autoincrement the per-file reset doesn't rewind, so the
    // expectation reads it rather than assuming this is the first message ever.
    const [message] = await getDb(testEnv).select({ id: chatMessages.id }).from(chatMessages).all();

    expect(await pulse()).toEqual({
      pickCount: 1,
      lastChatId: message!.id,
      lastSyncAt: new Date('2026-09-15T00:00:00Z').getTime(),
      currentWeek: 3,
      draftStatus: 'active',
      onlineCount: 1,
    });
  });
});
