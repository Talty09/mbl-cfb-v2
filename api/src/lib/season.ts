import { desc, eq } from 'drizzle-orm';
import type { SeasonType } from 'shared';
import { seasons, syncState } from '../db/schema';
import type { Db } from './db';
import type { Env } from '../types';

/** sync_state key holding the ingest's view of where the calendar is. */
export const CALENDAR_KEY = 'calendar';

export interface CalendarCursor {
  /**
   * The season this position belongs to. Without it, a stored cursor from the
   * previous season reads as valid — so at the year rollover the per-week ingest
   * stages would target the wrong (season, week) pair, and the header would
   * advertise last season's final week.
   */
  season: number;
  week: number;
  seasonType: SeasonType;
}

/**
 * The season to operate on: whichever row is flagged current, falling back to
 * the CURRENT_SEASON var so a fresh database still answers requests instead of
 * 500ing.
 */
export async function resolveSeason(db: Db, env: Env): Promise<number> {
  const current = await db
    .select({ year: seasons.year })
    .from(seasons)
    .where(eq(seasons.isCurrent, true))
    .orderBy(desc(seasons.year))
    .get();

  return current?.year ?? Number.parseInt(env.CURRENT_SEASON, 10);
}

/**
 * Where the CFBD calendar says we are, for the given season. Null until the
 * ingest has run at least once, or when the stored cursor belongs to a different
 * season — both mean "no current week", which callers must treat as the normal
 * preseason state.
 */
export async function readCalendar(db: Db, season: number): Promise<CalendarCursor | null> {
  const row = await db
    .select({ cursor: syncState.cursor })
    .from(syncState)
    .where(eq(syncState.key, CALENDAR_KEY))
    .get();

  if (!row?.cursor) return null;

  try {
    const parsed = JSON.parse(row.cursor) as Partial<CalendarCursor>;
    if (typeof parsed.week !== 'number') return null;
    // Stale cursor from another season: report no current week rather than a
    // confidently wrong one. The next calendar sync overwrites it.
    if (parsed.season !== season) return null;
    return {
      season,
      week: parsed.week,
      seasonType: parsed.seasonType === 'postseason' ? 'postseason' : 'regular',
    };
  } catch {
    // A malformed cursor is an ingest bug, not a reason to fail every read.
    return null;
  }
}
