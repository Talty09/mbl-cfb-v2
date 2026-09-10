import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { api } from '../app';
import { games, syncState } from '../db/schema';
import { getDb } from '../lib/db';
import { migrate, seedManagers, sessionCookieFrom, testEnv } from '../test/helpers';

const PASSPHRASE = 'bench-helm-dusk-lantern-ermine-kettle';
const mockedFetch = vi.fn<typeof fetch>();

async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return api.fetch(
    new Request(`https://mbl.test${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
    testEnv,
  );
}

async function commissionerCookie(): Promise<string> {
  const response = await post('/api/auth/login', { username: 'tom', password: PASSPHRASE });
  return sessionCookieFrom(response)!;
}

describe('POST /api/admin/sync', () => {
  beforeEach(async () => {
    await migrate();
    await seedManagers([{ username: 'tom', password: PASSPHRASE, isCommissioner: true }]);
    const db = getDb(testEnv);
    await db.insert(syncState).values([
      {
        key: 'calendar',
        cursor: JSON.stringify({ season: 2026, week: 9, seasonType: 'regular' }),
        lastRunAt: new Date('2026-10-20T00:00:00.000Z'),
      },
      {
        key: 'ingest',
        cursor: JSON.stringify({ week: 9, seasonType: 'regular', rotation: 3 }),
        lastRunAt: new Date('2026-10-20T00:00:00.000Z'),
      },
    ]);
    mockedFetch.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('rejects partial historical targets instead of silently using the live week', async () => {
    const cookie = await commissionerCookie();

    const response = await post(
      '/api/admin/sync',
      { slice: 'games', season: 2025, week: 1 },
      cookie,
    );

    expect(response.status).toBe(400);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('rejects historical targets for non-weekly slices', async () => {
    const cookie = await commissionerCookie();

    const response = await post(
      '/api/admin/sync',
      { slice: 'calendar', season: 2025, week: 1, seasonType: 'regular' },
      cookie,
    );

    expect(response.status).toBe(400);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('syncs games for the exact historical target without changing scheduler state', async () => {
    const cookie = await commissionerCookie();
    vi.stubGlobal('fetch', mockedFetch);
    mockedFetch.mockImplementationOnce(async (input) => {
      expect(String(input)).toBe(
        'https://api.collegefootballdata.com/games?year=2025&week=1&seasonType=regular&classification=fbs',
      );
      return Response.json([
        {
          id: 501,
          season: 2025,
          week: 1,
          seasonType: 'regular',
          startDate: '2025-08-30T16:00:00.000Z',
          completed: true,
          venue: 'Historical Stadium',
          homeId: 10,
          awayId: 20,
          homePoints: 31,
          awayPoints: 17,
          notes: null,
        },
      ]);
    });

    const db = getDb(testEnv);
    const before = await db.select().from(syncState);
    const response = await post(
      '/api/admin/sync',
      { slice: 'games', season: 2025, week: 1, seasonType: 'regular' },
      cookie,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      stage: 'games',
      season: 2025,
      week: 1,
      seasonType: 'regular',
    });
    expect(await db.select().from(games).where(eq(games.id, 501)).get()).toMatchObject({
      season: 2025,
      week: 1,
      completed: true,
      homePoints: 31,
      awayPoints: 17,
    });
    expect(await db.select().from(syncState)).toEqual(before);
  });
});
