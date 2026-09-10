import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { games, pollRanks, seasons, syncState, teams } from '../../db/schema';
import { getDb } from '../../lib/db';
import { migrate, testEnv } from '../../test/helpers';
import { runIngestSlice } from '.';

const CFBD_ORIGIN = 'https://api.collegefootballdata.com';
const mockedFetch = vi.fn<typeof fetch>();

function mockGames(body: unknown): void {
  mockedFetch.mockImplementationOnce(async (input) => {
    expect(String(input)).toBe(
      `${CFBD_ORIGIN}/games?year=2025&week=1&seasonType=regular&classification=fbs`,
    );
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

function mockTeams(body: unknown): void {
  mockedFetch.mockImplementationOnce(async (input) => {
    expect(String(input)).toBe(`${CFBD_ORIGIN}/teams/fbs?year=2025`);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

function mockRankings(body: unknown): void {
  mockedFetch.mockImplementationOnce(async (input) => {
    expect(String(input)).toBe(`${CFBD_ORIGIN}/rankings?year=2025&week=1&seasonType=regular`);
    return Response.json(body);
  });
}

describe('CFBD ingest integration', () => {
  beforeEach(async () => {
    await migrate();
    mockedFetch.mockReset();
    vi.stubGlobal('fetch', mockedFetch);

    const db = getDb(testEnv);
    await db.insert(seasons).values({ year: 2025, isCurrent: true });
    await db.insert(syncState).values({
      key: 'calendar',
      cursor: JSON.stringify({ season: 2025, week: 1, seasonType: 'regular' }),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('updates every mutable team field from a later pull', async () => {
    const original = {
      id: 10,
      school: 'Old School',
      mascot: 'Old Mascot',
      abbreviation: 'OLD',
      conference: 'Old Conference',
      division: 'Old Division',
      classification: 'fbs',
      color: '#111111',
      alternateColor: '#222222',
      logos: ['https://old.example/logo.png'],
    };
    mockTeams([original]);
    await runIngestSlice(getDb(testEnv), testEnv, { force: 'teams' });

    mockTeams([
      {
        ...original,
        school: 'New School',
        mascot: 'New Mascot',
        abbreviation: 'NEW',
        conference: 'New Conference',
        division: 'New Division',
        classification: 'FBS',
        color: '#333333',
        alternateColor: '#444444',
        logos: ['https://new.example/logo.png'],
      },
    ]);
    await runIngestSlice(getDb(testEnv), testEnv, { force: 'teams' });

    expect(await getDb(testEnv).select().from(teams).where(eq(teams.id, 10)).get()).toMatchObject({
      school: 'New School',
      mascot: 'New Mascot',
      abbreviation: 'NEW',
      conference: 'New Conference',
      division: 'New Division',
      classification: 'FBS',
      color: '#333333',
      altColor: '#444444',
      logoUrl: 'https://new.example/logo.png',
    });
  });

  it('updates an incomplete game with the final score returned by a later pull', async () => {
    const scheduled = {
      id: 1001,
      season: 2025,
      week: 1,
      seasonType: 'regular',
      startDate: '2025-08-30T16:00:00.000Z',
      completed: false,
      venue: 'Old Venue',
      homeId: 10,
      awayId: 20,
      homePoints: null,
      awayPoints: null,
      notes: null,
    };
    mockGames([scheduled]);
    await runIngestSlice(getDb(testEnv), testEnv, { force: 'games' });

    mockGames([
      {
        ...scheduled,
        startDate: '2025-08-30T17:00:00.000Z',
        completed: true,
        venue: 'Final Venue',
        homePoints: 31,
        awayPoints: 17,
      },
    ]);
    await runIngestSlice(getDb(testEnv), testEnv, { force: 'games' });

    const stored = await getDb(testEnv).select().from(games).where(eq(games.id, 1001)).get();
    expect(stored).toMatchObject({
      completed: true,
      homePoints: 31,
      awayPoints: 17,
      venue: 'Final Venue',
    });
    expect(stored?.startDate?.toISOString()).toBe('2025-08-30T17:00:00.000Z');
  });

  it('rejects an empty regular-season AP poll without erasing the last good ranks', async () => {
    const db = getDb(testEnv);
    await db.insert(pollRanks).values({
      season: 2025,
      week: 1,
      seasonType: 'regular',
      poll: 'AP Top 25',
      teamId: 10,
      rank: 1,
    });
    mockRankings([]);

    await expect(runIngestSlice(db, testEnv, { force: 'rankings' })).rejects.toThrow(
      /no AP Top 25/i,
    );

    expect(await db.select().from(pollRanks)).toHaveLength(1);
  });
});
