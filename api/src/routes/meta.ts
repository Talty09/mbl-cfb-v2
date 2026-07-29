import { and, desc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Meta } from 'shared';
import { games, seasons, syncState } from '../db/schema';
import { getDb } from '../lib/db';
import { readCalendar, resolveSeason } from '../lib/season';
import type { AppEnv } from '../types';

/** A game that kicked off within this window and isn't final is "in progress". */
const LIVE_WINDOW_MS = 6 * 60 * 60 * 1000;

export const metaRoutes = new Hono<AppEnv>();

/**
 * Everything the app shell needs on load — header labels, draft status, and
 * ingest freshness — in one request rather than four.
 */
metaRoutes.get('/meta', async (c) => {
  const db = getDb(c.env);
  const season = await resolveSeason(db, c.env);
  const now = Date.now();

  const [seasonRow, calendar, live, sync] = await Promise.all([
    db
      .select({ draftStatus: seasons.draftStatus })
      .from(seasons)
      .where(eq(seasons.year, season))
      .get(),
    readCalendar(db),
    db
      .select({ n: sql<number>`count(*)` })
      .from(games)
      .where(
        and(
          eq(games.season, season),
          eq(games.completed, false),
          lte(games.startDate, new Date(now)),
          gte(games.startDate, new Date(now - LIVE_WINDOW_MS)),
        ),
      )
      .get(),
    db
      .select({ lastRunAt: syncState.lastRunAt, lastError: syncState.lastError })
      .from(syncState)
      .where(isNotNull(syncState.lastRunAt))
      .orderBy(desc(syncState.lastRunAt))
      .limit(1)
      .get(),
  ]);

  const body: Meta = {
    season,
    currentWeek: calendar?.week ?? null,
    seasonType: calendar?.seasonType ?? 'regular',
    // A season row may not exist yet on a fresh database.
    draftStatus: seasonRow?.draftStatus ?? 'pending',
    hasGamesInProgress: (live?.n ?? 0) > 0,
    lastSyncAt: sync?.lastRunAt?.getTime() ?? null,
    lastSyncError: sync?.lastError ?? null,
  };

  return c.json(body);
});
