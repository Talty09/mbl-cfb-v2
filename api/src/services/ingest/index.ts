/**
 * CFBD ingest.
 *
 * One slice per cron firing, driven by a cursor in `sync_state`. The scheduled
 * handler gets the same 10 ms CPU budget as a request, so a whole-season pull is
 * not an option — see plan.ts for the stage-selection policy.
 *
 * Nothing here is on a read path. Views read `games`, `teams`, `poll_ranks` and
 * `game_points` from D1, so a CFBD outage degrades freshness and nothing else.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { SeasonType } from 'shared';
import { games, pollRanks, syncState, teams } from '../../db/schema';
import { cfbdGet } from '../../lib/cfbd';
import { insertChunked, type Db } from '../../lib/db';
import { readCalendar, resolveSeason, CALENDAR_KEY } from '../../lib/season';
import { purgeExpiredSessions } from '../../lib/session';
import { classifyGame } from '../scoring';
import { AP_POLL, recomputeWeekPoints } from '../points';
import {
  advance,
  chooseStage,
  INITIAL_CURSOR,
  isInSeasonWindow,
  resolveCurrentWeek,
  type IngestCursor,
  type IngestStage,
} from './plan';
import {
  cfbdCalendarSchema,
  cfbdGamesSchema,
  cfbdRankingsSchema,
  cfbdTeamsSchema,
  normalizeSeasonType,
  parseDate,
} from './schemas';
import type { Env } from '../../types';

const CURSOR_KEY = 'ingest';
const TEAMS_KEY = 'teams';

export interface SliceOutcome {
  stage: IngestStage | 'skipped';
  season: number;
  week?: number;
  seasonType?: SeasonType;
  detail: string;
  /** Rows touched, for the log line. */
  rows?: number;
}

export type HistoricalIngestStage = Extract<IngestStage, 'games' | 'rankings' | 'points'>;

async function readState(db: Db, key: string) {
  return db.select().from(syncState).where(eq(syncState.key, key)).get();
}

async function writeState(
  db: Db,
  key: string,
  values: { cursor?: string | null; lastRunAt?: Date | null; lastError?: string | null },
): Promise<void> {
  await db
    .insert(syncState)
    .values({ key, cursor: values.cursor ?? null, lastRunAt: values.lastRunAt ?? null, lastError: values.lastError ?? null })
    .onConflictDoUpdate({ target: syncState.key, set: values });
}

function readCursor(raw: string | null | undefined): IngestCursor {
  if (!raw) return INITIAL_CURSOR;
  try {
    const parsed = JSON.parse(raw) as Partial<IngestCursor>;
    return {
      week: typeof parsed.week === 'number' ? parsed.week : INITIAL_CURSOR.week,
      seasonType: parsed.seasonType === 'postseason' ? 'postseason' : 'regular',
      rotation: typeof parsed.rotation === 'number' ? parsed.rotation : 0,
    };
  } catch {
    return INITIAL_CURSOR;
  }
}

/** ---- Stage: teams ---------------------------------------------------- */

async function syncTeams(db: Db, env: Env, season: number): Promise<SliceOutcome> {
  const fetched = await cfbdGet(env, '/teams/fbs', { year: season }, cfbdTeamsSchema);

  const rows = fetched.map((team) => ({
    id: team.id,
    school: team.school,
    mascot: team.mascot ?? null,
    abbreviation: team.abbreviation ?? null,
    conference: team.conference ?? null,
    division: team.division ?? null,
    classification: team.classification ?? null,
    color: team.color ?? null,
    altColor: team.alternateColor ?? null,
    logoUrl: team.logos?.[0] ?? null,
  }));

  const written = await insertChunked(rows, 10, (chunk) =>
    db
      .insert(teams)
      .values(chunk)
      .onConflictDoUpdate({
        target: teams.id,
        set: {
          school: sql`excluded.school`,
          mascot: sql`excluded.mascot`,
          abbreviation: sql`excluded.abbreviation`,
          conference: sql`excluded.conference`,
          division: sql`excluded.division`,
          classification: sql`excluded.classification`,
          color: sql`excluded.color`,
          altColor: sql`excluded.alt_color`,
          logoUrl: sql`excluded.logo_url`,
        },
      }),
  );

  await writeState(db, TEAMS_KEY, { lastRunAt: new Date(), lastError: null });
  return { stage: 'teams', season, detail: `${written.rows} FBS teams`, rows: written.rows };
}

/** ---- Stage: calendar ------------------------------------------------- */

async function syncCalendar(
  db: Db,
  env: Env,
  season: number,
  now: Date,
): Promise<SliceOutcome> {
  const fetched = await cfbdGet(env, '/calendar', { year: season }, cfbdCalendarSchema);

  const weeks = fetched
    .map((entry) => ({
      week: entry.week,
      seasonType: normalizeSeasonType(entry.seasonType),
      firstGameStart: parseDate(entry.firstGameStart),
    }))
    .filter(
      (entry): entry is { week: number; seasonType: SeasonType; firstGameStart: Date | null } =>
        entry.seasonType !== null,
    );

  const current = resolveCurrentWeek(weeks, now);

  await writeState(db, CALENDAR_KEY, {
    // Season is part of the cursor so a stored position can never be mistaken
    // for the current one after a year rollover.
    cursor: current ? JSON.stringify({ season, ...current }) : null,
    lastRunAt: now,
    lastError: null,
  });

  return {
    stage: 'calendar',
    season,
    ...(current ?? {}),
    detail: current
      ? `current week ${current.week} (${current.seasonType})`
      : 'season has not started',
  };
}

/** ---- Stage: games ---------------------------------------------------- */

const GAME_COLUMNS = 13;

async function syncGames(
  db: Db,
  env: Env,
  season: number,
  week: number,
  seasonType: SeasonType,
): Promise<SliceOutcome> {
  const fetched = await cfbdGet(
    env,
    '/games',
    { year: season, week, seasonType, classification: 'fbs' },
    cfbdGamesSchema,
  );

  const rows = fetched
    .filter((game) => normalizeSeasonType(game.seasonType) !== null)
    .map((game) => ({
      id: game.id,
      season: game.season,
      week: game.week,
      seasonType: normalizeSeasonType(game.seasonType)!,
      startDate: parseDate(game.startDate),
      completed: game.completed ?? false,
      homeTeamId: game.homeId ?? null,
      awayTeamId: game.awayId ?? null,
      homePoints: game.homePoints ?? null,
      awayPoints: game.awayPoints ?? null,
      notes: game.notes ?? null,
      // Resolved once, here, so the CFP-at-a-bowl distinction is settled at
      // ingest instead of being re-derived on every read.
      kind: classifyGame({
        seasonType: normalizeSeasonType(game.seasonType)!,
        notes: game.notes ?? null,
      }),
      venue: game.venue ?? null,
    }));

  const written = await insertChunked(rows, GAME_COLUMNS, (chunk) =>
    db
      .insert(games)
      .values(chunk)
      .onConflictDoUpdate({
        target: games.id,
        set: {
          season: sql`excluded.season`,
          week: sql`excluded.week`,
          seasonType: sql`excluded.season_type`,
          startDate: sql`excluded.start_date`,
          completed: sql`excluded.completed`,
          homeTeamId: sql`excluded.home_team_id`,
          awayTeamId: sql`excluded.away_team_id`,
          homePoints: sql`excluded.home_points`,
          awayPoints: sql`excluded.away_points`,
          notes: sql`excluded.notes`,
          kind: sql`excluded.kind`,
          venue: sql`excluded.venue`,
        },
      }),
  );

  return {
    stage: 'games',
    season,
    week,
    seasonType,
    detail: `${written.rows} games in week ${week}`,
    rows: written.rows,
  };
}

/** ---- Stage: rankings ------------------------------------------------- */

async function syncRankings(
  db: Db,
  env: Env,
  season: number,
  week: number,
  seasonType: SeasonType,
): Promise<SliceOutcome> {
  const fetched = await cfbdGet(
    env,
    '/rankings',
    { year: season, week, seasonType },
    cfbdRankingsSchema,
  );

  // CFBD returns every poll it tracks, including FCS and Division II/III. Only
  // the AP poll drives the league's Top-25 bonus.
  const apRanks = fetched
    .filter((entry) => normalizeSeasonType(entry.seasonType) === seasonType)
    .flatMap((entry) => entry.polls)
    .filter((poll) => poll.poll === AP_POLL)
    .flatMap((poll) => poll.ranks)
    .filter((rank) => rank.teamId != null);

  const rows = apRanks.map((rank) => ({
    season,
    week,
    seasonType,
    poll: AP_POLL,
    teamId: rank.teamId!,
    rank: rank.rank,
  }));

  // An empty regular-season AP response is much more likely to be an upstream
  // outage or schema change than a real poll. Never erase a known-good poll and
  // silently downgrade ranked wins to one point.
  if (seasonType === 'regular' && rows.length === 0) {
    throw new Error(`CFBD returned no AP Top 25 for regular-season week ${week}`);
  }

  // A week's poll is a complete set, so replace it rather than merging — a team
  // that drops out must actually disappear.
  await db
    .delete(pollRanks)
    .where(
      and(
        eq(pollRanks.season, season),
        eq(pollRanks.week, week),
        eq(pollRanks.seasonType, seasonType),
        eq(pollRanks.poll, AP_POLL),
      ),
    );

  const written = await insertChunked(rows, 6, (chunk) => db.insert(pollRanks).values(chunk));

  return {
    stage: 'rankings',
    season,
    week,
    seasonType,
    detail:
      written.rows > 0
        ? `${written.rows} AP ranks for week ${week}`
        : `no AP poll published for week ${week}`,
    rows: written.rows,
  };
}

/** ---- Historical runner ---------------------------------------------- */

/**
 * Run one exact per-week slice without consulting or advancing cron state.
 * Historical repairs must not move the live calendar or scheduler rotation.
 */
export async function runHistoricalIngestSlice(
  db: Db,
  env: Env,
  target: {
    stage: HistoricalIngestStage;
    season: number;
    week: number;
    seasonType: SeasonType;
  },
): Promise<SliceOutcome> {
  const { stage, season, week, seasonType } = target;

  switch (stage) {
    case 'games':
      return syncGames(db, env, season, week, seasonType);
    case 'rankings':
      return syncRankings(db, env, season, week, seasonType);
    case 'points': {
      const result = await recomputeWeekPoints(db, season, week, seasonType);
      return {
        stage: 'points',
        season,
        week,
        seasonType,
        detail: `${result.rowsWritten} scoring rows, ${result.pointsAwarded} points from ${result.gamesScored} completed games`,
        rows: result.rowsWritten,
      };
    }
  }
}

/** ---- Runner ---------------------------------------------------------- */

/**
 * Run exactly one slice of ingest work.
 *
 * Errors are recorded in `sync_state.last_error` and rethrown so the cron logs
 * them; `/api/meta` surfaces the message, so a broken ingest is visible in the
 * UI rather than silently stale.
 */
export async function runIngestSlice(
  db: Db,
  env: Env,
  options: { now?: Date; force?: IngestStage } = {},
): Promise<SliceOutcome> {
  const now = options.now ?? new Date();
  const season = await resolveSeason(db, env);

  if (!options.force && !isInSeasonWindow(now)) {
    return { stage: 'skipped', season, detail: 'outside the August-January season window' };
  }

  const [cursorRow, teamsRow, calendarRow] = await Promise.all([
    readState(db, CURSOR_KEY),
    readState(db, TEAMS_KEY),
    readState(db, CALENDAR_KEY),
  ]);

  const cursor = readCursor(cursorRow?.cursor);
  const stage =
    options.force ??
    chooseStage(
      cursor,
      {
        teamsSyncedAt: teamsRow?.lastRunAt?.getTime() ?? null,
        calendarSyncedAt: calendarRow?.lastRunAt?.getTime() ?? null,
      },
      now,
    );

  // The calendar decides which week the per-week stages operate on; the cursor
  // only carries the rotation.
  const calendar = await readCalendar(db, season);
  const week = calendar?.week ?? cursor.week;
  const seasonType = calendar?.seasonType ?? cursor.seasonType;

  try {
    let outcome: SliceOutcome;

    switch (stage) {
      case 'teams':
        outcome = await syncTeams(db, env, season);
        break;
      case 'calendar':
        outcome = await syncCalendar(db, env, season, now);
        break;
      case 'games':
        outcome = calendar
          ? await syncGames(db, env, season, week, seasonType)
          : { stage: 'skipped', season, detail: 'no current week yet' };
        break;
      case 'rankings':
        outcome = calendar
          ? await syncRankings(db, env, season, week, seasonType)
          : { stage: 'skipped', season, detail: 'no current week yet' };
        break;
      case 'points': {
        if (!calendar) {
          outcome = { stage: 'skipped', season, detail: 'no current week yet' };
          break;
        }
        const result = await recomputeWeekPoints(db, season, week, seasonType);
        outcome = {
          stage: 'points',
          season,
          week,
          seasonType,
          detail: `${result.rowsWritten} scoring rows, ${result.pointsAwarded} points from ${result.gamesScored} completed games`,
          rows: result.rowsWritten,
        };
        break;
      }
    }

    await writeState(db, CURSOR_KEY, {
      cursor: JSON.stringify(advance({ ...cursor, week, seasonType })),
      lastRunAt: now,
      lastError: null,
    });

    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Advance the rotation even on failure, so one persistently broken stage
    // cannot starve the others.
    await writeState(db, CURSOR_KEY, {
      cursor: JSON.stringify(advance({ ...cursor, week, seasonType })),
      lastRunAt: now,
      lastError: `${stage}: ${message}`,
    });
    throw error;
  }
}

/**
 * Housekeeping that doesn't need CFBD. Cheap enough to ride along with the cron
 * rather than earning its own stage.
 */
export async function runMaintenance(db: Db): Promise<void> {
  await purgeExpiredSessions(db);
}
