import { beforeEach, describe, expect, it } from 'vitest';
import { gamePoints, games, picks, pollRanks, teams } from '../db/schema';
import { getDb } from '../lib/db';
import { migrate, SEASON, seedManagers, testEnv } from '../test/helpers';
import { AP_POLL, recomputeWeekPoints } from './points';

const MICHIGAN = 130;
const OHIO_STATE = 194;
const TEXAS = 251;
const ALABAMA = 333;

async function addTeams(): Promise<void> {
  await getDb(testEnv)
    .insert(teams)
    .values([
      { id: MICHIGAN, school: 'Michigan' },
      { id: OHIO_STATE, school: 'Ohio State' },
      { id: TEXAS, school: 'Texas' },
      { id: ALABAMA, school: 'Alabama' },
    ]);
}

interface GameSpec {
  id: number;
  week?: number;
  seasonType?: 'regular' | 'postseason';
  home: number;
  away: number;
  homePoints: number | null;
  awayPoints: number | null;
  completed?: boolean;
  notes?: string | null;
  kind?: 'regular' | 'conference_championship' | 'bowl' | 'playoff_round' | 'national_championship';
}

async function addGame(spec: GameSpec): Promise<void> {
  await getDb(testEnv)
    .insert(games)
    .values({
      id: spec.id,
      season: SEASON,
      week: spec.week ?? 1,
      seasonType: spec.seasonType ?? 'regular',
      startDate: new Date('2026-09-05T16:00:00Z'),
      completed: spec.completed ?? true,
      homeTeamId: spec.home,
      awayTeamId: spec.away,
      homePoints: spec.homePoints,
      awayPoints: spec.awayPoints,
      notes: spec.notes ?? null,
      kind: spec.kind ?? 'regular',
      venue: null,
    });
}

async function own(userId: string, teamId: number, pickNumber: number): Promise<void> {
  await getDb(testEnv)
    .insert(picks)
    .values({
      id: `pick_${pickNumber}`,
      seasonYear: SEASON,
      pickNumber,
      userId,
      teamId,
      madeByUserId: userId,
      createdAt: new Date(),
    });
}

async function rank(teamId: number, position: number, week = 1): Promise<void> {
  await getDb(testEnv)
    .insert(pollRanks)
    .values({
      season: SEASON,
      week,
      seasonType: 'regular',
      poll: AP_POLL,
      teamId,
      rank: position,
    });
}

async function storedPoints() {
  return getDb(testEnv).select().from(gamePoints).all();
}

describe('recomputeWeekPoints', () => {
  beforeEach(async () => {
    await migrate();
    await seedManagers([{ username: 'tom', password: 'x' }, { username: 'zac', password: 'y' }]);
    await addTeams();
  });

  it('awards 1 point for an unranked regular-season win', async () => {
    await own('usr_tom', MICHIGAN, 1);
    await addGame({ id: 1, home: MICHIGAN, away: ALABAMA, homePoints: 30, awayPoints: 20 });

    const result = await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular');

    expect(result.rowsWritten).toBe(1);
    expect(result.pointsAwarded).toBe(1);
    const rows = await storedPoints();
    expect(rows[0]).toMatchObject({ userId: 'usr_tom', teamId: MICHIGAN, points: 1, beatTop25: false });
  });

  it('awards 2 for beating a team ranked that week, and flags it', async () => {
    await own('usr_tom', MICHIGAN, 1);
    await rank(ALABAMA, 8);
    await addGame({ id: 1, home: MICHIGAN, away: ALABAMA, homePoints: 30, awayPoints: 20 });

    await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular');

    const rows = await storedPoints();
    expect(rows[0]).toMatchObject({ points: 2, beatTop25: true });
  });

  it('uses that week\'s poll, not the opponent\'s ranking in another week', async () => {
    await own('usr_tom', MICHIGAN, 1);
    // Alabama is ranked in week 2 but not week 1; the week-1 game gets no bonus.
    await rank(ALABAMA, 8, 2);
    await addGame({ id: 1, week: 1, home: MICHIGAN, away: ALABAMA, homePoints: 30, awayPoints: 20 });

    await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular');

    const rows = await storedPoints();
    expect(rows[0]!.points).toBe(1);
    expect(rows[0]!.beatTop25).toBe(false);
  });

  it('awards nothing for a loss', async () => {
    await own('usr_tom', MICHIGAN, 1);
    await addGame({ id: 1, home: MICHIGAN, away: ALABAMA, homePoints: 17, awayPoints: 24 });

    const result = await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular');
    expect(result.rowsWritten).toBe(0);
    expect(await storedPoints()).toHaveLength(0);
  });

  it('awards nothing for a tie', async () => {
    await own('usr_tom', MICHIGAN, 1);
    await addGame({ id: 1, home: MICHIGAN, away: ALABAMA, homePoints: 21, awayPoints: 21 });

    expect((await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular')).rowsWritten).toBe(0);
  });

  it('ignores games that are not finished', async () => {
    await own('usr_tom', MICHIGAN, 1);
    await addGame({
      id: 1,
      home: MICHIGAN,
      away: ALABAMA,
      homePoints: 14,
      awayPoints: 7,
      completed: false,
    });

    const result = await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular');
    expect(result.gamesScored).toBe(0);
    expect(result.rowsWritten).toBe(0);
  });

  it('credits only the winner when one manager owns both teams', async () => {
    await own('usr_tom', MICHIGAN, 1);
    await own('usr_tom', OHIO_STATE, 2);
    await addGame({ id: 1, home: MICHIGAN, away: OHIO_STATE, homePoints: 13, awayPoints: 30 });

    await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular');

    const rows = await storedPoints();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ teamId: OHIO_STATE, points: 1 });
  });

  it('credits nobody when the winner is unowned', async () => {
    await own('usr_tom', MICHIGAN, 1);
    await addGame({ id: 1, home: ALABAMA, away: TEXAS, homePoints: 31, awayPoints: 10 });

    expect((await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular')).rowsWritten).toBe(0);
  });

  it('pays postseason rates and never stacks the Top 25 bonus onto them', async () => {
    await own('usr_tom', MICHIGAN, 1);
    await rank(ALABAMA, 3);
    await addGame({
      id: 1,
      seasonType: 'postseason',
      home: MICHIGAN,
      away: ALABAMA,
      homePoints: 28,
      awayPoints: 21,
      notes: 'College Football Playoff Quarterfinal at the Rose Bowl',
      kind: 'playoff_round',
    });

    await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'postseason');

    const rows = await storedPoints();
    // 3 for a playoff win, not 3 + 2, and not 2 for a "Bowl".
    expect(rows[0]).toMatchObject({ points: 3, kind: 'playoff_round', beatTop25: false });
  });

  it('is idempotent — recomputing does not double-count', async () => {
    await own('usr_tom', MICHIGAN, 1);
    await addGame({ id: 1, home: MICHIGAN, away: ALABAMA, homePoints: 30, awayPoints: 20 });

    await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular');
    await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular');
    await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular');

    const rows = await storedPoints();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.points).toBe(1);
  });

  it('removes a row when a game stops qualifying', async () => {
    await own('usr_tom', MICHIGAN, 1);
    await addGame({ id: 1, home: MICHIGAN, away: ALABAMA, homePoints: 30, awayPoints: 20 });
    await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular');
    expect(await storedPoints()).toHaveLength(1);

    // A corrected score flips the result; the stale scoring row must disappear
    // rather than linger, which an upsert would have allowed.
    const { eq } = await import('drizzle-orm');
    await getDb(testEnv)
      .update(games)
      .set({ homePoints: 20, awayPoints: 30 })
      .where(eq(games.id, 1));

    await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular');
    expect(await storedPoints()).toHaveLength(0);
  });

  it('removes a stale row when a scored game moves out of the requested week', async () => {
    await own('usr_tom', MICHIGAN, 1);
    await addGame({ id: 1, week: 1, home: MICHIGAN, away: ALABAMA, homePoints: 30, awayPoints: 20 });
    await addGame({ id: 2, week: 2, home: MICHIGAN, away: TEXAS, homePoints: 27, awayPoints: 24 });
    await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular');
    await recomputeWeekPoints(getDb(testEnv), SEASON, 2, 'regular');

    const { eq } = await import('drizzle-orm');
    await getDb(testEnv).update(games).set({ week: 2 }).where(eq(games.id, 1));

    await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular');

    const rows = await storedPoints();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gameId: 2, week: 2 });
  });

  it('scopes recomputation to the requested week', async () => {
    await own('usr_tom', MICHIGAN, 1);
    await addGame({ id: 1, week: 1, home: MICHIGAN, away: ALABAMA, homePoints: 30, awayPoints: 20 });
    await addGame({ id: 2, week: 2, home: MICHIGAN, away: TEXAS, homePoints: 27, awayPoints: 24 });

    await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular');
    await recomputeWeekPoints(getDb(testEnv), SEASON, 2, 'regular');
    expect(await storedPoints()).toHaveLength(2);

    // Rerunning week 1 must leave week 2's row alone.
    await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular');
    expect(await storedPoints()).toHaveLength(2);
  });

  it('splits points between managers correctly', async () => {
    await own('usr_tom', MICHIGAN, 1);
    await own('usr_zac', TEXAS, 2);
    await rank(ALABAMA, 5);
    await addGame({ id: 1, home: MICHIGAN, away: ALABAMA, homePoints: 30, awayPoints: 20 });
    await addGame({ id: 2, home: TEXAS, away: OHIO_STATE, homePoints: 21, awayPoints: 14 });

    const result = await recomputeWeekPoints(getDb(testEnv), SEASON, 1, 'regular');

    expect(result.pointsAwarded).toBe(3); // tom 2 (ranked win) + zac 1
    const rows = await storedPoints();
    expect(rows.find((r) => r.userId === 'usr_tom')!.points).toBe(2);
    expect(rows.find((r) => r.userId === 'usr_zac')!.points).toBe(1);
  });
});
