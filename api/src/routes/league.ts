/**
 * The read APIs behind Scoreboard, Standings, Past Scores and Locker Room.
 *
 * All public. Browsing without signing in is a supported state, so nothing here
 * consults the session — only write routes gate on one.
 *
 * No point value appears in this file. `game_points` is materialized by
 * services/points.ts from the rules in services/scoring.ts, and every total
 * below is a SUM over that table, so a rule change lands in one tested place and
 * these endpoints follow it. The aggregation stays in SQL for a second reason:
 * the free plan allows 50 D1 queries and 10 ms of CPU per invocation, and one
 * GROUP BY beats both a per-manager query loop and a reduce over every row.
 */

import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type {
  ApiError,
  GameKind,
  Manager,
  ManagerRef,
  RosterCard,
  ScoreboardGame,
  ScoreboardResponse,
  ScoreboardTeam,
  SeasonType,
  StandingsResponse,
  StandingsRow,
  TeamOption,
  WeekScoresResponse,
  WeekScoresRow,
} from 'shared';
import { gamePoints, games, picks, pollRanks, teams, users } from '../db/schema';
import { getDb, type Db } from '../lib/db';
import { readCalendar, resolveSeason, type CalendarCursor } from '../lib/season';
import { AP_POLL } from '../services/points';
import type { AppEnv } from '../types';

export const leagueRoutes = new Hono<AppEnv>();

/** Highest week CFBD produces, counting the postseason. Bounds the week params. */
const MAX_WEEK = 20;

/** A game whose participant we hold no `teams` row for — an FCS opponent. */
const NON_FBS_SCHOOL = 'Non-FBS opponent';

/** A scheduled slot with no team assigned yet, e.g. an unfilled bowl. */
const UNDECIDED_SCHOOL = 'TBD';

interface WinLoss {
  wins: number;
  losses: number;
}

const NO_RECORD: WinLoss = { wins: 0, losses: 0 };

/** The (week, seasonType) pair a request is asking about. */
interface WeekSlice {
  week: number;
  seasonType: SeasonType;
}

/** ---- Shared reads ---------------------------------------------------- */

/**
 * Real-life W-L for every team with a completed game this season.
 *
 * Two grouped queries rather than one over a UNION: a team's games are split
 * between `home_team_id` and `away_team_id`, and aggregating each side on its own
 * keeps both statements on an index (`games_season_home_idx`,
 * `games_season_away_idx`). Ties count as neither a win nor a loss.
 */
async function realRecords(db: Db, season: number): Promise<Map<number, WinLoss>> {
  const decided = and(
    eq(games.season, season),
    eq(games.completed, true),
    isNotNull(games.homePoints),
    isNotNull(games.awayPoints),
  );

  const [home, away] = await Promise.all([
    db
      .select({
        teamId: games.homeTeamId,
        wins: sql<number>`sum(case when ${games.homePoints} > ${games.awayPoints} then 1 else 0 end)`,
        losses: sql<number>`sum(case when ${games.homePoints} < ${games.awayPoints} then 1 else 0 end)`,
      })
      .from(games)
      .where(and(decided, isNotNull(games.homeTeamId)))
      .groupBy(games.homeTeamId)
      .all(),
    db
      .select({
        teamId: games.awayTeamId,
        wins: sql<number>`sum(case when ${games.awayPoints} > ${games.homePoints} then 1 else 0 end)`,
        losses: sql<number>`sum(case when ${games.awayPoints} < ${games.homePoints} then 1 else 0 end)`,
      })
      .from(games)
      .where(and(decided, isNotNull(games.awayTeamId)))
      .groupBy(games.awayTeamId)
      .all(),
  ]);

  const records = new Map<number, WinLoss>();
  for (const row of [...home, ...away]) {
    if (row.teamId === null) continue;
    const running = records.get(row.teamId) ?? NO_RECORD;
    records.set(row.teamId, {
      wins: running.wins + row.wins,
      losses: running.losses + row.losses,
    });
  }
  return records;
}

/**
 * AP Top 25 membership for one week: team id -> rank.
 *
 * Keyed by week on purpose — a scoreboard card shows the rank the opponent held
 * when the game was played, not where they ended up.
 */
async function ranksForWeek(
  db: Db,
  season: number,
  slice: WeekSlice | null,
): Promise<Map<number, number>> {
  if (slice === null) return new Map();

  const rows = await db
    .select({ teamId: pollRanks.teamId, rank: pollRanks.rank })
    .from(pollRanks)
    .where(
      and(
        eq(pollRanks.season, season),
        eq(pollRanks.week, slice.week),
        eq(pollRanks.seasonType, slice.seasonType),
        eq(pollRanks.poll, AP_POLL),
      ),
    )
    .all();

  return new Map(rows.map((row) => [row.teamId, row.rank]));
}

/** Every manager, for endpoints that must list all of them regardless of scoring. */
async function allManagers(db: Db): Promise<ManagerRef[]> {
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, avatarHue: users.avatarHue })
    .from(users)
    .all();
  return rows.map(managerRef);
}

/** Season points per manager, for the endpoints that need a total but not a breakdown. */
async function seasonTotals(db: Db, season: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ userId: gamePoints.userId, total: sql<number>`sum(${gamePoints.points})` })
    .from(gamePoints)
    .where(eq(gamePoints.season, season))
    .groupBy(gamePoints.userId)
    .all();
  return new Map(rows.map((row) => [row.userId, row.total]));
}

/** ---- Shaping --------------------------------------------------------- */

function managerRef(row: { id: string; displayName: string; avatarHue: number }): ManagerRef {
  return { id: row.id, displayName: row.displayName, avatarHue: row.avatarHue };
}

/** A LEFT JOIN on users nulls every column together; collapse that to one null. */
function optionalManager(row: {
  ownerId: string | null;
  ownerName: string | null;
  ownerHue: number | null;
}): ManagerRef | null {
  if (row.ownerId === null || row.ownerName === null || row.ownerHue === null) return null;
  return { id: row.ownerId, displayName: row.ownerName, avatarHue: row.ownerHue };
}

/** Ranked teams first in AP order, then everyone else alphabetically. */
function byRankThenSchool(
  a: { rank: number | null; school: string },
  b: { rank: number | null; school: string },
): number {
  if (a.rank !== b.rank) {
    if (a.rank === null) return 1;
    if (b.rank === null) return -1;
    return a.rank - b.rank;
  }
  return a.school.localeCompare(b.school);
}

/**
 * Standard competition ranking over an already-sorted list of scores: equal
 * scores share a rank (1, 2, 2, 4).
 *
 * The league has never defined a tiebreaker — CLAUDE.md says to ask the owner
 * rather than invent one — so tied managers must not be handed distinct ranks,
 * which would assert an order we do not have. The surrounding sort falls back to
 * display name purely to make the response stable.
 *
 * TODO: ask the league owner for a tiebreaker (head-to-head? ranked wins?) and
 * apply it here and in the sort above.
 */
function competitionRanks(scores: number[]): number[] {
  let previous: number | null = null;
  let rank = 0;
  return scores.map((score, index) => {
    if (score !== previous) {
      rank = index + 1;
      previous = score;
    }
    return rank;
  });
}

/** Regular season sorts ahead of the postseason, whose week numbers restart. */
function seasonTypeOrder(seasonType: SeasonType): number {
  return seasonType === 'regular' ? 0 : 1;
}

/** ---- Params ---------------------------------------------------------- */

function parseWeek(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const week = Number(raw);
  if (!Number.isInteger(week) || week < 1 || week > MAX_WEEK) return null;
  return week;
}

function parseSeasonType(raw: string | undefined): SeasonType | null {
  return raw === 'regular' || raw === 'postseason' ? raw : null;
}

/**
 * Which (week, seasonType) the caller means.
 *
 * Week numbers restart in the postseason, so a bare `?week=1` is ambiguous.
 * `?seasonType=` settles it explicitly; without it we answer for the calendar's
 * season type when no week was named — the "this week" case the Scoreboard opens
 * on — and for the regular season otherwise, since those are the weeks the Past
 * Scores chips walk. Week 1 is the fallback on a database with no calendar yet,
 * so a fresh deploy answers with an empty week instead of failing.
 */
function resolveSlice(
  week: number | null,
  seasonType: SeasonType | null,
  calendar: CalendarCursor | null,
): WeekSlice {
  if (week === null) {
    return {
      week: calendar?.week ?? 1,
      seasonType: seasonType ?? calendar?.seasonType ?? 'regular',
    };
  }
  if (seasonType !== null) return { week, seasonType };
  if (calendar?.week === week) return { week, seasonType: calendar.seasonType };
  return { week, seasonType: 'regular' };
}

/** ---- GET /api/league/managers ---------------------------------------- */

/**
 * The league roll, with season points. Powers manager pickers and the chat
 * header, so a manager who has not scored yet has to appear with 0 rather than
 * drop out — hence the LEFT JOIN.
 */
leagueRoutes.get('/league/managers', async (c) => {
  const db = getDb(c.env);
  const season = await resolveSeason(db, c.env);

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarHue: users.avatarHue,
      isCommissioner: users.isCommissioner,
      points: sql<number>`coalesce(sum(${gamePoints.points}), 0)`,
    })
    .from(users)
    .leftJoin(gamePoints, and(eq(gamePoints.userId, users.id), eq(gamePoints.season, season)))
    .groupBy(users.id)
    .all();

  const body: Manager[] = rows.sort(
    (a, b) => b.points - a.points || a.displayName.localeCompare(b.displayName),
  );

  return c.json(body);
});

/** ---- GET /api/teams -------------------------------------------------- */

/**
 * The draft pool. `available=1` narrows it to undrafted teams, which is what the
 * Draft Room's panel asks for; without it the whole pool comes back with owners
 * attached.
 *
 * No classification filter: `teams` is populated from CFBD's `/teams/fbs`, so
 * every row in it is already an FBS team.
 */
leagueRoutes.get('/teams', async (c) => {
  const db = getDb(c.env);
  const season = await resolveSeason(db, c.env);
  const calendar = await readCalendar(db, season);
  const availableRaw = c.req.query('available');
  const availableOnly = availableRaw === '1' || availableRaw === 'true';

  const [rows, records, ranks] = await Promise.all([
    db
      .select({
        id: teams.id,
        school: teams.school,
        mascot: teams.mascot,
        conference: teams.conference,
        ownerId: users.id,
        ownerName: users.displayName,
        ownerHue: users.avatarHue,
      })
      .from(teams)
      .leftJoin(picks, and(eq(picks.teamId, teams.id), eq(picks.seasonYear, season)))
      .leftJoin(users, eq(users.id, picks.userId))
      .all(),
    realRecords(db, season),
    ranksForWeek(db, season, calendar),
  ]);

  const pool: TeamOption[] = rows
    .filter((row) => !availableOnly || row.ownerId === null)
    .map((row) => ({
      id: row.id,
      school: row.school,
      mascot: row.mascot,
      conference: row.conference,
      rank: ranks.get(row.id) ?? null,
      ...(records.get(row.id) ?? NO_RECORD),
      ownedBy: optionalManager(row),
    }))
    .sort(byRankThenSchool);

  return c.json(pool);
});

/** ---- GET /api/scoreboard --------------------------------------------- */

/**
 * One week of games with fantasy attribution.
 *
 * Teams are joined in memory rather than with six more SQL joins (two sides ×
 * team, owner, rank): the maps below are one query each and bounded by the
 * league — ~136 teams, 110 picks, 25 ranks — while the equivalent statement
 * would be unreadable and no cheaper.
 */
leagueRoutes.get('/scoreboard', async (c) => {
  const db = getDb(c.env);
  const rawWeek = c.req.query('week');
  if (rawWeek !== undefined && parseWeek(rawWeek) === null) {
    return c.json<ApiError>({ error: 'Invalid week' }, 400);
  }

  const season = await resolveSeason(db, c.env);
  const calendar = await readCalendar(db, season);
  const slice = resolveSlice(
    parseWeek(rawWeek),
    parseSeasonType(c.req.query('seasonType')),
    calendar,
  );
  const [weekGames, scored, owners, schools, records, ranks] = await Promise.all([
    db
      .select({
        id: games.id,
        startDate: games.startDate,
        completed: games.completed,
        kind: games.kind,
        notes: games.notes,
        homeTeamId: games.homeTeamId,
        awayTeamId: games.awayTeamId,
        homePoints: games.homePoints,
        awayPoints: games.awayPoints,
      })
      .from(games)
      .where(
        and(
          eq(games.season, season),
          eq(games.week, slice.week),
          eq(games.seasonType, slice.seasonType),
        ),
      )
      .all(),
    db
      .select({
        gameId: gamePoints.gameId,
        teamId: gamePoints.teamId,
        points: gamePoints.points,
        kind: gamePoints.kind,
        beatTop25: gamePoints.beatTop25,
        id: users.id,
        displayName: users.displayName,
        avatarHue: users.avatarHue,
      })
      .from(gamePoints)
      .innerJoin(users, eq(users.id, gamePoints.userId))
      .where(
        and(
          eq(gamePoints.season, season),
          eq(gamePoints.week, slice.week),
          eq(gamePoints.seasonType, slice.seasonType),
        ),
      )
      .all(),
    db
      .select({
        teamId: picks.teamId,
        id: users.id,
        displayName: users.displayName,
        avatarHue: users.avatarHue,
      })
      .from(picks)
      .innerJoin(users, eq(users.id, picks.userId))
      .where(eq(picks.seasonYear, season))
      .all(),
    // Whole table, unfiltered: an IN list of a week's team ids would carry more
    // bound parameters than D1 accepts, and the table is ~136 rows.
    db.select({ id: teams.id, school: teams.school }).from(teams).all(),
    realRecords(db, season),
    ranksForWeek(db, season, slice),
  ]);

  const schoolsById = new Map(schools.map((row) => [row.id, row.school]));
  const ownersByTeam = new Map(owners.map((row) => [row.teamId, managerRef(row)]));
  const scoredByGame = new Map(scored.map((row) => [row.gameId, row]));

  /**
   * A game's team may have no `teams` row — FBS schools play FCS opponents we
   * never ingest. Those sides report a null id and a placeholder rather than
   * dropping the game, and their record is left at 0-0: we only hold the
   * fraction of their schedule that ran against an FBS team.
   */
  const side = (teamId: number | null, points: number | null): ScoreboardTeam => {
    const school = teamId === null ? UNDECIDED_SCHOOL : schoolsById.get(teamId);
    if (teamId === null || school === undefined) {
      return {
        teamId: null,
        school: school ?? NON_FBS_SCHOOL,
        rank: null,
        ...NO_RECORD,
        points,
        owner: null,
      };
    }
    return {
      teamId,
      school,
      rank: ranks.get(teamId) ?? null,
      ...(records.get(teamId) ?? NO_RECORD),
      points,
      owner: ownersByTeam.get(teamId) ?? null,
    };
  };

  const gameCards: ScoreboardGame[] = weekGames
    .map((game) => {
      const fantasy = scoredByGame.get(game.id);
      return {
        id: game.id,
        startDate: game.startDate?.getTime() ?? null,
        completed: game.completed,
        kind: game.kind,
        notes: game.notes,
        home: side(game.homeTeamId, game.homePoints),
        away: side(game.awayTeamId, game.awayPoints),
        fantasy: fantasy
          ? {
              user: managerRef(fantasy),
              points: fantasy.points,
              // `game_points.kind` is free text in the schema; the only writer is
              // services/points.ts, which carries `games.kind` through verbatim.
              kind: fantasy.kind as GameKind,
              beatTop25: fantasy.beatTop25,
            }
          : null,
      };
    })
    // Kickoff order, with any game missing a start date last rather than first.
    .sort(
      (a, b) =>
        (a.startDate ?? Number.MAX_SAFE_INTEGER) - (b.startDate ?? Number.MAX_SAFE_INTEGER) ||
        a.id - b.id,
    );

  // Derived from the scoring rows already loaded above rather than a second
  // GROUP BY — a week is at most one row per game.
  const weekPoints = new Map<string, { user: ManagerRef; points: number }>();
  for (const row of scored) {
    const running = weekPoints.get(row.id);
    if (running) running.points += row.points;
    else weekPoints.set(row.id, { user: managerRef(row), points: row.points });
  }
  const ballerOfTheWeek =
    [...weekPoints.values()].sort(
      (a, b) => b.points - a.points || a.user.displayName.localeCompare(b.user.displayName),
    )[0] ?? null;

  const body: ScoreboardResponse = {
    season,
    week: slice.week,
    seasonType: slice.seasonType,
    games: gameCards,
    ballerOfTheWeek,
  };

  return c.json(body);
});

/** ---- GET /api/standings ---------------------------------------------- */

/**
 * The season leaderboard, plus the per-week breakdown Past Scores and the
 * Rivalry Watch chart both read.
 */
leagueRoutes.get('/standings', async (c) => {
  const db = getDb(c.env);
  const season = await resolveSeason(db, c.env);
  const calendar = await readCalendar(db, season);

  const [managers, totals, weekly] = await Promise.all([
    allManagers(db),
    db
      .select({
        userId: gamePoints.userId,
        total: sql<number>`sum(${gamePoints.points})`,
        // beat_top25 stores 0/1, so SUM is a count. points.ts only ever sets it
        // on regular-season games, which is exactly the design's RANKED column.
        rankedWins: sql<number>`sum(${gamePoints.beatTop25})`,
      })
      .from(gamePoints)
      .where(eq(gamePoints.season, season))
      .groupBy(gamePoints.userId)
      .all(),
    db
      .select({
        week: gamePoints.week,
        seasonType: gamePoints.seasonType,
        userId: gamePoints.userId,
        points: sql<number>`sum(${gamePoints.points})`,
      })
      .from(gamePoints)
      .where(eq(gamePoints.season, season))
      .groupBy(gamePoints.seasonType, gamePoints.week, gamePoints.userId)
      .all(),
  ]);

  const totalsById = new Map(totals.map((row) => [row.userId, row]));

  // One bucket per (seasonType, week) that scored anything, with every manager
  // keyed at 0 so the chart never has to fill holes.
  const buckets = new Map<string, { slice: WeekSlice; points: Record<string, number> }>();
  for (const row of weekly) {
    const key = `${row.seasonType}:${row.week}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        slice: { week: row.week, seasonType: row.seasonType },
        points: Object.fromEntries(managers.map((manager) => [manager.id, 0])),
      };
      buckets.set(key, bucket);
    }
    bucket.points[row.userId] = row.points;
  }

  const current = calendar ? buckets.get(`${calendar.seasonType}:${calendar.week}`) : undefined;

  const sorted = managers
    .map((user) => ({
      user,
      weekPoints: current?.points[user.id] ?? 0,
      rankedWins: totalsById.get(user.id)?.rankedWins ?? 0,
      total: totalsById.get(user.id)?.total ?? 0,
    }))
    .sort((a, b) => b.total - a.total || a.user.displayName.localeCompare(b.user.displayName));

  const ranks = competitionRanks(sorted.map((row) => row.total));
  const rows: StandingsRow[] = sorted.map((row, index) => ({ rank: ranks[index]!, ...row }));

  const body: StandingsResponse = {
    season,
    currentWeek: calendar?.week ?? null,
    rows,
    weekly: [...buckets.values()]
      .sort(
        (a, b) =>
          seasonTypeOrder(a.slice.seasonType) - seasonTypeOrder(b.slice.seasonType) ||
          a.slice.week - b.slice.week,
      )
      // The contract carries a bare week number, so a postseason week 1 and a
      // regular-season week 1 arrive as two entries with the same label. Summing
      // them together would be worse (bowl points showing up in September), and
      // renumbering the postseason would invent a convention the league has not
      // agreed to. TODO: settle the postseason week labels with the owner.
      .map((bucket) => ({ week: bucket.slice.week, points: bucket.points })),
  };

  return c.json(body);
});

/** ---- GET /api/weeks/:week/scores ------------------------------------- */

/**
 * One week's table for Past Scores: managers ordered by that week's points, each
 * carrying their season total. Every manager appears, including those who scored
 * nothing that week.
 */
leagueRoutes.get('/weeks/:week/scores', async (c) => {
  const week = parseWeek(c.req.param('week'));
  if (week === null) return c.json<ApiError>({ error: 'Invalid week' }, 400);

  const db = getDb(c.env);
  const season = await resolveSeason(db, c.env);
  const calendar = await readCalendar(db, season);
  const slice = resolveSlice(week, parseSeasonType(c.req.query('seasonType')), calendar);

  const [managers, weekRows, totals] = await Promise.all([
    allManagers(db),
    db
      .select({ userId: gamePoints.userId, points: sql<number>`sum(${gamePoints.points})` })
      .from(gamePoints)
      .where(
        and(
          eq(gamePoints.season, season),
          eq(gamePoints.week, slice.week),
          eq(gamePoints.seasonType, slice.seasonType),
        ),
      )
      .groupBy(gamePoints.userId)
      .all(),
    seasonTotals(db, season),
  ]);

  const weekById = new Map(weekRows.map((row) => [row.userId, row.points]));

  const sorted = managers
    .map((user) => ({
      user,
      weekPoints: weekById.get(user.id) ?? 0,
      seasonTotal: totals.get(user.id) ?? 0,
    }))
    .sort(
      (a, b) => b.weekPoints - a.weekPoints || a.user.displayName.localeCompare(b.user.displayName),
    );

  const ranks = competitionRanks(sorted.map((row) => row.weekPoints));
  const rows: WeekScoresRow[] = sorted.map((row, index) => ({ rank: ranks[index]!, ...row }));

  const body: WeekScoresResponse = { season, week: slice.week, rows };
  return c.json(body);
});

/** ---- GET /api/rosters ------------------------------------------------ */

/**
 * The Locker Room: one card per manager with their drafted teams and what each
 * has earned.
 *
 * Starts from `users`, not `picks`, so all eleven cards exist before the draft
 * has happened. `game_points` joins on team alone because ownership is exclusive
 * per season — `picks_season_team_unq` is the guarantee — so a team's scoring
 * rows can only belong to the manager holding it. That also makes each card's
 * total identical to the manager's standings total.
 */
leagueRoutes.get('/rosters', async (c) => {
  const db = getDb(c.env);
  const season = await resolveSeason(db, c.env);
  const calendar = await readCalendar(db, season);

  const [rows, records, ranks] = await Promise.all([
    db
      .select({
        ownerId: users.id,
        ownerName: users.displayName,
        ownerHue: users.avatarHue,
        teamId: teams.id,
        school: teams.school,
        mascot: teams.mascot,
        conference: teams.conference,
        points: sql<number>`coalesce(sum(${gamePoints.points}), 0)`,
      })
      .from(users)
      .leftJoin(picks, and(eq(picks.userId, users.id), eq(picks.seasonYear, season)))
      .leftJoin(teams, eq(teams.id, picks.teamId))
      .leftJoin(gamePoints, and(eq(gamePoints.teamId, picks.teamId), eq(gamePoints.season, season)))
      .groupBy(users.id, picks.teamId)
      .all(),
    realRecords(db, season),
    ranksForWeek(db, season, calendar),
  ]);

  const cards = new Map<string, RosterCard>();
  for (const row of rows) {
    const user = optionalManager(row);
    if (user === null) continue;

    let card = cards.get(user.id);
    if (!card) {
      card = { user, total: 0, teams: [] };
      cards.set(user.id, card);
    }

    // A null team id is the LEFT JOIN's placeholder for a manager who has not
    // drafted yet, not a missing team: picks.team_id has a FK to teams.
    if (row.teamId === null || row.school === null) continue;

    card.teams.push({
      id: row.teamId,
      school: row.school,
      mascot: row.mascot,
      conference: row.conference,
      rank: ranks.get(row.teamId) ?? null,
      ...(records.get(row.teamId) ?? NO_RECORD),
      ownedBy: user,
      points: row.points,
    });
    card.total += row.points;
  }

  const body: RosterCard[] = [...cards.values()]
    .map((card) => ({ ...card, teams: card.teams.sort(byRankThenSchool) }))
    .sort((a, b) => b.total - a.total || a.user.displayName.localeCompare(b.user.displayName));

  return c.json(body);
});
