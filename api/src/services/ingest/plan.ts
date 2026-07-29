/**
 * Which slice of ingest work to do next.
 *
 * Split out as pure functions so the scheduling policy is unit-testable without
 * touching CFBD or D1 — the interesting behaviour here is the decisions, not the
 * I/O.
 *
 * One slice per cron firing. A scheduled handler gets the same 10 ms CPU budget
 * as a request, and parsing a full week of games is already a meaningful chunk of
 * it, so batching stages would risk being killed mid-write.
 */

import type { SeasonType } from 'shared';

export type IngestStage = 'teams' | 'calendar' | 'games' | 'rankings' | 'points';

export interface IngestCursor {
  /** The (week, seasonType) the ingest is currently tracking. */
  week: number;
  seasonType: SeasonType;
  /** Rotation position among the auxiliary stages. */
  rotation: number;
}

export interface StageFreshness {
  teamsSyncedAt: number | null;
  calendarSyncedAt: number | null;
}

/** Teams change once a year; re-checking weekly is generous. */
export const TEAMS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The calendar only shifts when CFBD adjusts the schedule. */
export const CALENDAR_TTL_MS = 60 * 60 * 1000;

/**
 * College football runs August through mid-January. Outside that, the cron
 * still fires every 5 minutes but should cost almost nothing.
 */
export function isInSeasonWindow(now: Date): boolean {
  const month = now.getUTCMonth(); // 0 = January
  return month >= 7 || month === 0;
}

/**
 * Saturdays in season, plus weekday evenings — when scores are actually moving
 * and the scoreboard wants to look live.
 *
 * Deliberately coarse: the cost of being wrong is one extra CFBD call, and a
 * precise answer would need the game schedule this function is meant to avoid
 * loading.
 */
export function isLikelyGameWindow(now: Date): boolean {
  const day = now.getUTCDay(); // 0 = Sunday
  const hour = now.getUTCHours();
  // Kickoffs run from Saturday noon ET through early Sunday UTC.
  const saturdayBlock = day === 6 && hour >= 15;
  const sundayEarly = day === 0 && hour < 8;
  // Thursday and Friday night games.
  const weeknightBlock = (day === 4 || day === 5) && hour >= 22;
  return saturdayBlock || sundayEarly || weeknightBlock;
}

/**
 * Pick the stage for this firing.
 *
 * Priority: teams and the calendar first when stale, because everything else is
 * keyed off them. Otherwise rotate. During a game window the rotation drops
 * `rankings` — polls are published midweek and cannot change on a Saturday
 * afternoon — so scores and points refresh twice as often.
 */
export function chooseStage(
  cursor: IngestCursor,
  freshness: StageFreshness,
  now: Date,
): IngestStage {
  const at = now.getTime();

  if (freshness.teamsSyncedAt === null || at - freshness.teamsSyncedAt > TEAMS_TTL_MS) {
    return 'teams';
  }
  if (freshness.calendarSyncedAt === null || at - freshness.calendarSyncedAt > CALENDAR_TTL_MS) {
    return 'calendar';
  }

  const rotation = isLikelyGameWindow(now)
    ? (['games', 'points'] as const)
    : (['games', 'rankings', 'points'] as const);

  return rotation[cursor.rotation % rotation.length]!;
}

export const INITIAL_CURSOR: IngestCursor = { week: 1, seasonType: 'regular', rotation: 0 };

/** Advance the rotation. Week movement is driven by the calendar stage, not here. */
export function advance(cursor: IngestCursor): IngestCursor {
  return { ...cursor, rotation: (cursor.rotation + 1) % 6 };
}

/**
 * Where the season is now, from the CFBD calendar.
 *
 * Picks the last week whose first game has already started, so mid-week the
 * ingest keeps refreshing the week in progress rather than jumping ahead to one
 * with no results yet. Before the opener there is no current week at all.
 */
export function resolveCurrentWeek(
  weeks: { week: number; seasonType: SeasonType; firstGameStart: Date | null }[],
  now: Date,
): { week: number; seasonType: SeasonType } | null {
  const started = weeks
    .filter((entry) => entry.firstGameStart !== null && entry.firstGameStart <= now)
    .sort((a, b) => a.firstGameStart!.getTime() - b.firstGameStart!.getTime());

  const latest = started.at(-1);
  if (!latest) return null;
  return { week: latest.week, seasonType: latest.seasonType };
}
