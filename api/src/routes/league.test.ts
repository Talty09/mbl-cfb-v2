import { Hono } from 'hono';
import type {
  GameKind,
  Manager,
  RosterCard,
  ScoreboardResponse,
  SeasonType,
  StandingsResponse,
  TeamOption,
  WeekScoresResponse,
} from 'shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { draftOrder, games, picks, pollRanks, syncState, teams } from '../db/schema';
import { getDb } from '../lib/db';
import { CALENDAR_KEY } from '../lib/season';
import { AP_POLL, recomputeWeekPoints } from '../services/points';
import { migrate, SEASON, seedManagers, testEnv } from '../test/helpers';
import { leagueRoutes } from './league';
import type { AppEnv } from '../types';

/**
 * Mounted the way app.ts mounts every other route module. A local app rather
 * than the shared `api` instance because wiring these routes in is the lead's
 * call — this still exercises the module exactly as it will be mounted.
 */
const app = new Hono<AppEnv>().basePath('/api');
app.route('/', leagueRoutes);

async function get<T>(path: string): Promise<{ status: number; body: T }> {
  const response = await app.fetch(new Request(`https://mbl.test${path}`), testEnv);
  return { status: response.status, body: (await response.json()) as T };
}

/** ---- Fixture --------------------------------------------------------- */

const MICHIGAN = 130;
const OHIO_STATE = 194;
const TEXAS = 251;
const ALABAMA = 333;
const OREGON = 2483;
const GEORGIA = 61;
const PENN_STATE = 213;
const NOTRE_DAME = 87;

/** An FCS opponent: it plays FBS teams but never lands in the `teams` table. */
const FCS_OPPONENT = 999_999;

const SCHOOLS: [number, string][] = [
  [MICHIGAN, 'Michigan'],
  [OHIO_STATE, 'Ohio State'],
  [TEXAS, 'Texas'],
  [ALABAMA, 'Alabama'],
  [OREGON, 'Oregon'],
  [GEORGIA, 'Georgia'],
  [PENN_STATE, 'Penn State'],
  [NOTRE_DAME, 'Notre Dame'],
];

async function addTeams(): Promise<void> {
  await getDb(testEnv)
    .insert(teams)
    .values(
      SCHOOLS.map(([id, school]) => ({
        id,
        school,
        mascot: `${school} mascot`,
        conference: 'Big Ten',
      })),
    );
}

interface GameSpec {
  id: number;
  week?: number;
  seasonType?: SeasonType;
  home: number | null;
  away: number | null;
  homePoints: number | null;
  awayPoints: number | null;
  completed?: boolean;
  notes?: string | null;
  kind?: GameKind;
  start?: Date | null;
}

async function addGame(spec: GameSpec): Promise<void> {
  const week = spec.week ?? 1;
  await getDb(testEnv)
    .insert(games)
    .values({
      id: spec.id,
      season: SEASON,
      week,
      seasonType: spec.seasonType ?? 'regular',
      startDate: spec.start === undefined ? new Date(Date.UTC(2026, 8, week, 16)) : spec.start,
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

async function own(username: string, teamId: number, pickNumber: number): Promise<void> {
  await getDb(testEnv)
    .insert(picks)
    .values({
      id: `pick_${pickNumber}`,
      seasonYear: SEASON,
      pickNumber,
      userId: `usr_${username}`,
      teamId,
      madeByUserId: `usr_${username}`,
      createdAt: new Date(),
    });
}

async function rank(
  teamId: number,
  position: number,
  week: number,
  seasonType: SeasonType = 'regular',
): Promise<void> {
  await getDb(testEnv)
    .insert(pollRanks)
    .values({ season: SEASON, week, seasonType, poll: AP_POLL, teamId, rank: position });
}

async function recompute(week: number, seasonType: SeasonType = 'regular'): Promise<void> {
  await recomputeWeekPoints(getDb(testEnv), SEASON, week, seasonType);
}

/** Stand in for the ingest's calendar stage, which is what "current week" means. */
async function setCalendar(week: number, seasonType: SeasonType = 'regular'): Promise<void> {
  const cursor = JSON.stringify({ season: SEASON, week, seasonType });
  await getDb(testEnv)
    .insert(syncState)
    .values({ key: CALENDAR_KEY, cursor, lastRunAt: new Date(), lastError: null })
    .onConflictDoUpdate({ target: syncState.key, set: { cursor } });
}

/**
 * Two played weeks, hand-computable end to end:
 *
 *   week 1  Michigan 30 Alabama 20   Alabama is AP #8 that week -> tom +2
 *           Texas 21 Oregon 14       unranked                   -> zac +1
 *           Ohio State 10 Georgia 24 Georgia is unowned         -> nobody
 *   week 2  Michigan 42 FCS 7        unranked                   -> tom +1
 *           Alabama 35 Texas 28      Texas is AP #3 that week   -> chris +2
 *           Ohio State 20 Oregon 17  Oregon is AP #12 that week -> tom +2
 *   week 3  Penn State - Notre Dame  not finished               -> nobody
 *
 * Totals: tom 5, chris 2, zac 1, dana 0. Ranked wins: tom 2, chris 1.
 * Records: Michigan 2-0, Alabama 1-1, Texas 1-1, Ohio State 1-1, Oregon 0-2,
 * Georgia 1-0, Penn State 0-0, Notre Dame 0-0.
 */
async function seedSeason(): Promise<void> {
  await addTeams();

  await getDb(testEnv).insert(draftOrder).values(
    ['tom', 'zac', 'chris', 'dana'].map((username, index) => ({
      seasonYear: SEASON,
      slot: index + 1,
      userId: `usr_${username}`,
    })),
  );

  await own('tom', MICHIGAN, 1);
  await own('tom', OHIO_STATE, 2);
  await own('zac', TEXAS, 3);
  await own('chris', ALABAMA, 4);

  await rank(ALABAMA, 8, 1);
  await rank(TEXAS, 3, 2);
  await rank(OREGON, 12, 2);

  await addGame({ id: 101, week: 1, home: MICHIGAN, away: ALABAMA, homePoints: 30, awayPoints: 20 });
  await addGame({ id: 102, week: 1, home: TEXAS, away: OREGON, homePoints: 21, awayPoints: 14 });
  await addGame({ id: 103, week: 1, home: OHIO_STATE, away: GEORGIA, homePoints: 10, awayPoints: 24 });

  await addGame({ id: 201, week: 2, home: MICHIGAN, away: FCS_OPPONENT, homePoints: 42, awayPoints: 7 });
  await addGame({ id: 202, week: 2, home: ALABAMA, away: TEXAS, homePoints: 35, awayPoints: 28 });
  await addGame({ id: 203, week: 2, home: OHIO_STATE, away: OREGON, homePoints: 20, awayPoints: 17 });

  await addGame({
    id: 301,
    week: 3,
    home: PENN_STATE,
    away: NOTRE_DAME,
    homePoints: 14,
    awayPoints: 7,
    completed: false,
  });

  await recompute(1);
  await recompute(2);
  await recompute(3);
  await setCalendar(2);
}

function teamNamed(pool: TeamOption[], school: string): TeamOption {
  const found = pool.find((team) => team.school === school);
  if (!found) throw new Error(`${school} missing from the response`);
  return found;
}

/** ---- Empty database -------------------------------------------------- */

describe('scoring views on an empty database', () => {
  // A fresh deploy has no managers, no games and no calendar. Every read view is
  // linked from the app shell, so all of them must answer rather than 500.
  beforeEach(migrate);

  it('returns an empty league roll', async () => {
    const { status, body } = await get<Manager[]>('/api/league/managers');
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it('returns an empty draft pool', async () => {
    expect((await get<TeamOption[]>('/api/teams')).body).toEqual([]);
    expect((await get<TeamOption[]>('/api/teams?available=1')).body).toEqual([]);
  });

  it('returns an empty scoreboard for week 1 rather than failing', async () => {
    const { status, body } = await get<ScoreboardResponse>('/api/scoreboard');
    expect(status).toBe(200);
    expect(body).toEqual({
      season: SEASON,
      week: 1,
      seasonType: 'regular',
      games: [],
      ballerOfTheWeek: null,
    });
  });

  it('returns empty standings with no current week', async () => {
    const { status, body } = await get<StandingsResponse>('/api/standings');
    expect(status).toBe(200);
    expect(body).toEqual({ season: SEASON, currentWeek: null, rows: [], weekly: [] });
  });

  it('returns an empty week table', async () => {
    const { status, body } = await get<WeekScoresResponse>('/api/weeks/4/scores');
    expect(status).toBe(200);
    expect(body).toEqual({ season: SEASON, week: 4, rows: [] });
  });

  it('returns no roster cards', async () => {
    const { status, body } = await get<RosterCard[]>('/api/rosters');
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });
});

/** ---- Seeded season --------------------------------------------------- */

describe('scoring views', () => {
  beforeEach(async () => {
    await migrate();
    await seedManagers([
      { username: 'tom', password: 'x', isCommissioner: true },
      { username: 'zac', password: 'y' },
      { username: 'chris', password: 'z' },
      { username: 'dana', password: 'w' },
    ]);
    await seedSeason();
  });

  describe('GET /api/league/managers', () => {
    it('sums season points and keeps managers who have not scored', async () => {
      const { body } = await get<Manager[]>('/api/league/managers');

      expect(body.map((manager) => [manager.displayName, manager.points])).toEqual([
        ['tom', 5],
        ['chris', 2],
        ['zac', 1],
        ['dana', 0],
      ]);
    });

    it('carries the identity fields the header and chat need', async () => {
      const { body } = await get<Manager[]>('/api/league/managers');

      expect(body[0]).toEqual({
        id: 'usr_tom',
        username: 'tom',
        displayName: 'tom',
        avatarHue: 200,
        isCommissioner: true,
        points: 5,
      });
    });

    it('excludes a login-only user who is not participating in this season', async () => {
      await seedManagers([{ username: 'josh.yagel', password: 'still-valid' }]);

      const managers = await get<Manager[]>('/api/league/managers');
      const standings = await get<StandingsResponse>('/api/standings');
      const week = await get<WeekScoresResponse>('/api/weeks/1/scores');
      const rosters = await get<RosterCard[]>('/api/rosters');

      expect(managers.body.map((manager) => manager.username)).not.toContain('josh.yagel');
      expect(standings.body.rows.map((row) => row.user.id)).not.toContain('usr_josh_yagel');
      expect(week.body.rows.map((row) => row.user.id)).not.toContain('usr_josh_yagel');
      expect(rosters.body.map((card) => card.user.id)).not.toContain('usr_josh_yagel');
    });
  });

  describe('GET /api/teams', () => {
    it('ranks by the current week, ordering ranked teams first', async () => {
      const { body } = await get<TeamOption[]>('/api/teams');

      expect(body).toHaveLength(SCHOOLS.length);
      expect(body.map((team) => team.school)).toEqual([
        // Current week is 2, whose AP poll has Texas 3rd and Oregon 12th.
        'Texas',
        'Oregon',
        'Alabama',
        'Georgia',
        'Michigan',
        'Notre Dame',
        'Ohio State',
        'Penn State',
      ]);
      expect(teamNamed(body, 'Texas').rank).toBe(3);
      expect(teamNamed(body, 'Oregon').rank).toBe(12);
      // Alabama was ranked in week 1 only, and week 1 is not the current week.
      expect(teamNamed(body, 'Alabama').rank).toBeNull();
    });

    it('reports the real-life record from home and away games alike', async () => {
      const { body } = await get<TeamOption[]>('/api/teams');

      expect(teamNamed(body, 'Michigan')).toMatchObject({ wins: 2, losses: 0 });
      expect(teamNamed(body, 'Ohio State')).toMatchObject({ wins: 1, losses: 1 });
      // Both of Oregon's losses came on the road.
      expect(teamNamed(body, 'Oregon')).toMatchObject({ wins: 0, losses: 2 });
      expect(teamNamed(body, 'Georgia')).toMatchObject({ wins: 1, losses: 0 });
    });

    it('ignores games that have not finished', async () => {
      const { body } = await get<TeamOption[]>('/api/teams');

      // Penn State leads 14-7 in an unfinished game; it is not a win yet.
      expect(teamNamed(body, 'Penn State')).toMatchObject({ wins: 0, losses: 0 });
      expect(teamNamed(body, 'Notre Dame')).toMatchObject({ wins: 0, losses: 0 });
    });

    it('counts a tie as neither a win nor a loss', async () => {
      await addGame({ id: 401, week: 4, home: PENN_STATE, away: NOTRE_DAME, homePoints: 21, awayPoints: 21 });

      const { body } = await get<TeamOption[]>('/api/teams');
      expect(teamNamed(body, 'Penn State')).toMatchObject({ wins: 0, losses: 0 });
      expect(teamNamed(body, 'Notre Dame')).toMatchObject({ wins: 0, losses: 0 });
    });

    it('attaches the owner drawn from picks', async () => {
      const { body } = await get<TeamOption[]>('/api/teams');

      expect(teamNamed(body, 'Michigan').ownedBy).toEqual({
        id: 'usr_tom',
        displayName: 'tom',
        avatarHue: 200,
      });
      expect(teamNamed(body, 'Georgia').ownedBy).toBeNull();
    });

    it('available=1 returns only undrafted teams', async () => {
      const { body } = await get<TeamOption[]>('/api/teams?available=1');

      expect(body.map((team) => team.school)).toEqual([
        'Oregon',
        'Georgia',
        'Notre Dame',
        'Penn State',
      ]);
      expect(body.every((team) => team.ownedBy === null)).toBe(true);
    });
  });

  describe('GET /api/scoreboard', () => {
    it('defaults to the calendar week', async () => {
      const { body } = await get<ScoreboardResponse>('/api/scoreboard');

      expect(body).toMatchObject({ season: SEASON, week: 2, seasonType: 'regular' });
      expect(body.games.map((game) => game.id)).toEqual([201, 202, 203]);
    });

    it('resolves both sides of a game with rank, record, score and owner', async () => {
      const { body } = await get<ScoreboardResponse>('/api/scoreboard?week=1');

      const opener = body.games.find((game) => game.id === 101)!;
      expect(opener.home).toEqual({
        teamId: MICHIGAN,
        school: 'Michigan',
        rank: null,
        wins: 2,
        losses: 0,
        points: 30,
        owner: { id: 'usr_tom', displayName: 'tom', avatarHue: 200 },
      });
      expect(opener.away).toEqual({
        teamId: ALABAMA,
        school: 'Alabama',
        // The rank Alabama held the week the game was played, not their current one.
        rank: 8,
        wins: 1,
        losses: 1,
        points: 20,
        owner: { id: 'usr_chris', displayName: 'chris', avatarHue: 200 },
      });
      expect(opener.completed).toBe(true);
      expect(opener.startDate).toBe(Date.UTC(2026, 8, 1, 16));
    });

    it('attributes fantasy points read from game_points', async () => {
      const { body } = await get<ScoreboardResponse>('/api/scoreboard?week=1');

      expect(body.games.find((game) => game.id === 101)!.fantasy).toEqual({
        user: { id: 'usr_tom', displayName: 'tom', avatarHue: 200 },
        points: 2,
        kind: 'regular',
        beatTop25: true,
      });
    });

    it('leaves fantasy null when nobody owns the winner', async () => {
      const { body } = await get<ScoreboardResponse>('/api/scoreboard?week=1');

      // Georgia won at Ohio State, and Georgia is undrafted.
      expect(body.games.find((game) => game.id === 103)!.fantasy).toBeNull();
    });

    it('keeps a game against a team we never ingested', async () => {
      const { body } = await get<ScoreboardResponse>('/api/scoreboard?week=2');

      const blowout = body.games.find((game) => game.id === 201)!;
      expect(blowout.away).toEqual({
        teamId: null,
        school: 'Non-FBS opponent',
        rank: null,
        wins: 0,
        losses: 0,
        points: 7,
        owner: null,
      });
      // The FBS side, and the scoring, are unaffected.
      expect(blowout.home.school).toBe('Michigan');
      expect(blowout.fantasy).toMatchObject({ points: 1, beatTop25: false });
    });

    it('handles a game with no team assigned yet', async () => {
      await addGame({ id: 402, week: 4, home: null, away: null, homePoints: null, awayPoints: null, completed: false });

      const { body } = await get<ScoreboardResponse>('/api/scoreboard?week=4');
      expect(body.games).toHaveLength(1);
      expect(body.games[0]!.home).toMatchObject({ teamId: null, school: 'TBD', points: null });
    });

    it('names the top scorer of the week', async () => {
      const week1 = await get<ScoreboardResponse>('/api/scoreboard?week=1');
      expect(week1.body.ballerOfTheWeek).toEqual({
        user: { id: 'usr_tom', displayName: 'tom', avatarHue: 200 },
        points: 2,
      });

      // Week 2 sums two of tom's wins against one of chris's.
      const week2 = await get<ScoreboardResponse>('/api/scoreboard?week=2');
      expect(week2.body.ballerOfTheWeek).toMatchObject({ points: 3 });
      expect(week2.body.ballerOfTheWeek!.user.displayName).toBe('tom');
    });

    it('has no baller in a week nobody scored', async () => {
      const { body } = await get<ScoreboardResponse>('/api/scoreboard?week=3');

      expect(body.games).toHaveLength(1);
      expect(body.games[0]!.fantasy).toBeNull();
      expect(body.ballerOfTheWeek).toBeNull();
    });

    it('orders games by kickoff, with an undated game last', async () => {
      await addGame({ id: 501, week: 5, home: GEORGIA, away: OREGON, homePoints: 1, awayPoints: 0, start: null });
      await addGame({
        id: 502,
        week: 5,
        home: PENN_STATE,
        away: NOTRE_DAME,
        homePoints: 1,
        awayPoints: 0,
        start: new Date(Date.UTC(2026, 9, 3, 12)),
      });

      const { body } = await get<ScoreboardResponse>('/api/scoreboard?week=5');
      expect(body.games.map((game) => game.id)).toEqual([502, 501]);
    });

    it('rejects a week that is not a week', async () => {
      expect((await get('/api/scoreboard?week=abc')).status).toBe(400);
      expect((await get('/api/scoreboard?week=0')).status).toBe(400);
      expect((await get('/api/scoreboard?week=99')).status).toBe(400);
    });
  });

  describe('GET /api/standings', () => {
    it('ranks by total points descending', async () => {
      const { body } = await get<StandingsResponse>('/api/standings');

      expect(body.season).toBe(SEASON);
      expect(body.currentWeek).toBe(2);
      expect(body.rows.map((row) => [row.rank, row.user.displayName, row.total])).toEqual([
        [1, 'tom', 5],
        [2, 'chris', 2],
        [3, 'zac', 1],
        [4, 'dana', 0],
      ]);
    });

    it('reports the current week\'s points beside the season total', async () => {
      const { body } = await get<StandingsResponse>('/api/standings');

      expect(
        body.rows.map((row) => [row.user.displayName, row.weekPoints]),
      ).toEqual([
        ['tom', 3],
        ['chris', 2],
        ['zac', 0],
        ['dana', 0],
      ]);
    });

    it('counts ranked wins, not wins', async () => {
      const { body } = await get<StandingsResponse>('/api/standings');

      expect(body.rows.map((row) => [row.user.displayName, row.rankedWins])).toEqual([
        // tom beat AP Alabama and AP Oregon; his win over the FCS team does not count.
        ['tom', 2],
        ['chris', 1],
        ['zac', 0],
        ['dana', 0],
      ]);
    });

    it('breaks the season down by week for every manager', async () => {
      const { body } = await get<StandingsResponse>('/api/standings');

      expect(body.weekly).toEqual([
        { week: 1, points: { usr_tom: 2, usr_zac: 1, usr_chris: 0, usr_dana: 0 } },
        { week: 2, points: { usr_tom: 3, usr_zac: 0, usr_chris: 2, usr_dana: 0 } },
      ]);
    });

    it('shares a rank between tied managers rather than inventing a tiebreaker', async () => {
      // Give zac a second point so he ties chris on 2.
      await addGame({ id: 601, week: 6, home: TEXAS, away: GEORGIA, homePoints: 24, awayPoints: 10 });
      await recompute(6);

      const { body } = await get<StandingsResponse>('/api/standings');

      expect(body.rows.map((row) => [row.rank, row.user.displayName, row.total])).toEqual([
        [1, 'tom', 5],
        // Equal totals share rank 2; the order between them is name order only.
        [2, 'chris', 2],
        [2, 'zac', 2],
        [4, 'dana', 0],
      ]);
    });
  });

  describe('GET /api/weeks/:week/scores', () => {
    it('orders managers by that week and carries the season total', async () => {
      const { body } = await get<WeekScoresResponse>('/api/weeks/1/scores');

      expect(body).toMatchObject({ season: SEASON, week: 1 });
      expect(
        body.rows.map((row) => [row.rank, row.user.displayName, row.weekPoints, row.seasonTotal]),
      ).toEqual([
        [1, 'tom', 2, 5],
        [2, 'zac', 1, 1],
        // Nobody else scored in week 1, so chris and dana share rank 3.
        [3, 'chris', 0, 2],
        [3, 'dana', 0, 0],
      ]);
    });

    it('reorders for a different week', async () => {
      const { body } = await get<WeekScoresResponse>('/api/weeks/2/scores');

      expect(body.rows.map((row) => [row.user.displayName, row.weekPoints])).toEqual([
        ['tom', 3],
        ['chris', 2],
        ['dana', 0],
        ['zac', 0],
      ]);
    });

    it('lists every manager with zero for a week nobody scored', async () => {
      const { body } = await get<WeekScoresResponse>('/api/weeks/3/scores');

      expect(body.rows).toHaveLength(4);
      expect(body.rows.every((row) => row.weekPoints === 0 && row.rank === 1)).toBe(true);
    });

    it('rejects a week that is not a week', async () => {
      expect((await get('/api/weeks/abc/scores')).status).toBe(400);
      expect((await get('/api/weeks/0/scores')).status).toBe(400);
      expect((await get('/api/weeks/2.5/scores')).status).toBe(400);
    });
  });

  describe('GET /api/rosters', () => {
    it('gives every manager a card, including one who has not drafted', async () => {
      const { body } = await get<RosterCard[]>('/api/rosters');

      expect(body.map((card) => [card.user.displayName, card.teams.length, card.total])).toEqual([
        ['tom', 2, 5],
        ['chris', 1, 2],
        ['zac', 1, 1],
        ['dana', 0, 0],
      ]);
    });

    it('reports what each team has earned, with its rank and record', async () => {
      const { body } = await get<RosterCard[]>('/api/rosters');

      const tom = body.find((card) => card.user.displayName === 'tom')!;
      expect(tom.teams.map((team) => [team.school, team.points])).toEqual([
        // tom's Michigan won twice (2 + 1) and Ohio State beat AP Oregon (2).
        ['Michigan', 3],
        ['Ohio State', 2],
      ]);
      expect(tom.teams[0]).toMatchObject({
        id: MICHIGAN,
        rank: null,
        wins: 2,
        losses: 0,
        ownedBy: { id: 'usr_tom', displayName: 'tom', avatarHue: 200 },
      });

      const zac = body.find((card) => card.user.displayName === 'zac')!;
      expect(zac.teams[0]).toMatchObject({ school: 'Texas', rank: 3, wins: 1, losses: 1, points: 1 });
    });

    it('totals to the same numbers as the standings', async () => {
      const rosters = await get<RosterCard[]>('/api/rosters');
      const standings = await get<StandingsResponse>('/api/standings');

      const fromRosters = rosters.body.map((card) => [card.user.id, card.total]).sort();
      const fromStandings = standings.body.rows.map((row) => [row.user.id, row.total]).sort();
      expect(fromRosters).toEqual(fromStandings);

      // And each card's total is exactly the sum of its teams.
      for (const card of rosters.body) {
        expect(card.total).toBe(card.teams.reduce((sum, team) => sum + team.points, 0));
      }
    });
  });

  describe('the postseason', () => {
    /**
     * A bowl win pays 2 with no Top-25 bonus stacked on it, so it must not show up
     * in the RANKED column even though the beaten team was ranked.
     */
    beforeEach(async () => {
      await rank(MICHIGAN, 5, 1, 'postseason');
      await addGame({
        id: 701,
        week: 1,
        seasonType: 'postseason',
        home: ALABAMA,
        away: MICHIGAN,
        homePoints: 24,
        awayPoints: 17,
        notes: 'Rose Bowl',
        kind: 'bowl',
      });
      await recompute(1, 'postseason');
    });

    it('adds bowl points to the total without counting them as ranked wins', async () => {
      const { body } = await get<StandingsResponse>('/api/standings');

      const chris = body.rows.find((row) => row.user.displayName === 'chris')!;
      expect(chris.total).toBe(4); // 2 in the regular season + 2 for the bowl
      expect(chris.rankedWins).toBe(1); // still just the week-2 win over AP Texas
    });

    it('keeps postseason week 1 separate from regular-season week 1', async () => {
      const regular = await get<ScoreboardResponse>('/api/scoreboard?week=1');
      expect(regular.body.seasonType).toBe('regular');
      expect(regular.body.games.map((game) => game.id)).toEqual([101, 102, 103]);

      const postseason = await get<ScoreboardResponse>(
        '/api/scoreboard?week=1&seasonType=postseason',
      );
      expect(postseason.body.seasonType).toBe('postseason');
      expect(postseason.body.games.map((game) => game.id)).toEqual([701]);
      expect(postseason.body.games[0]!.fantasy).toMatchObject({ kind: 'bowl', points: 2 });
      expect(postseason.body.ballerOfTheWeek).toMatchObject({ points: 2 });
    });

    it('follows the calendar into the postseason', async () => {
      await setCalendar(1, 'postseason');

      const scoreboard = await get<ScoreboardResponse>('/api/scoreboard');
      expect(scoreboard.body).toMatchObject({ week: 1, seasonType: 'postseason' });

      // The current-week column follows too.
      const standings = await get<StandingsResponse>('/api/standings');
      expect(standings.body.rows.find((row) => row.user.displayName === 'chris')!.weekPoints).toBe(2);
    });

    it('reports the postseason as its own weekly bucket', async () => {
      const { body } = await get<StandingsResponse>('/api/standings');

      // Two entries labelled week 1 — the regular-season one first. The response
      // contract has nowhere to say which is which; see the note in league.ts.
      expect(body.weekly).toHaveLength(3);
      expect(body.weekly.map((entry) => entry.week)).toEqual([1, 2, 1]);
      expect(body.weekly[2]!.points).toEqual({
        usr_tom: 0,
        usr_zac: 0,
        usr_chris: 2,
        usr_dana: 0,
      });
    });

    it('counts a bowl result in the real-life record', async () => {
      const { body } = await get<TeamOption[]>('/api/teams');

      expect(teamNamed(body, 'Alabama')).toMatchObject({ wins: 2, losses: 1 });
      expect(teamNamed(body, 'Michigan')).toMatchObject({ wins: 2, losses: 1 });
    });
  });
});
