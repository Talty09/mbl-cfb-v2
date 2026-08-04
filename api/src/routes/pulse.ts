import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Pulse } from 'shared';
import { chatMessages, picks, seasons, sessions, syncState } from '../db/schema';
import { getDb } from '../lib/db';
import { readCalendar, resolveSeason } from '../lib/season';
import { ONLINE_WINDOW_MS } from '../lib/session';
import type { AppEnv } from '../types';

export const pulseRoutes = new Hono<AppEnv>();

interface PulseCounters {
  pickCount: number;
  lastChatId: number;
  /** Epoch ms, straight off the timestamp_ms column. */
  lastSyncAt: number | null;
  onlineCount: number;
}

/**
 * The change-detector every client polls on an 8-second timer — by far the
 * hottest route in the app, and the one with the least to say.
 *
 * The four counters go out as one statement of scalar subqueries rather than four
 * round trips: nothing here needs a row, only an aggregate, and keeping the
 * result to a single row is what keeps the polling cost negligible against the
 * 10 ms CPU budget. Written as raw SQL through the Drizzle table and column
 * references, so a schema rename still fails the typecheck.
 */
pulseRoutes.get('/pulse', async (c) => {
  const db = getDb(c.env);
  const season = await resolveSeason(db, c.env);
  const onlineSince = Date.now() - ONLINE_WINDOW_MS;

  const [counters, seasonRow, calendar] = await Promise.all([
    db.get<PulseCounters | null>(sql`
      select
        (select count(*) from ${picks} where ${picks.seasonYear} = ${season}) as pickCount,
        (select coalesce(max(${chatMessages.id}), 0) from ${chatMessages}) as lastChatId,
        (select max(${syncState.lastRunAt}) from ${syncState}) as lastSyncAt,
        (
          select count(distinct ${sessions.userId}) from ${sessions}
          where ${sessions.lastSeenAt} >= ${onlineSince}
        ) as onlineCount
    `),
    db
      .select({ draftStatus: seasons.draftStatus })
      .from(seasons)
      .where(eq(seasons.year, season))
      .get(),
    readCalendar(db, season),
  ]);

  const body: Pulse = {
    pickCount: counters?.pickCount ?? 0,
    lastChatId: counters?.lastChatId ?? 0,
    lastSyncAt: counters?.lastSyncAt ?? null,
    currentWeek: calendar?.week ?? null,
    // A season row may not exist yet on a fresh database.
    draftStatus: seasonRow?.draftStatus ?? 'pending',
    onlineCount: counters?.onlineCount ?? 0,
  };

  return c.json(body);
});
