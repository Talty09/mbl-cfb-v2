/**
 * Materialize `game_points` from games + picks + poll ranks.
 *
 * The point values themselves are never restated here — this reads them from
 * `pointsForGame` in scoring.ts, which is the single source of truth per
 * CLAUDE.md. Expressing the rules as a SQL CASE would be faster and would also
 * mean two places to change when the league tweaks a rule.
 *
 * Recomputation is idempotent per week: delete that week's rows, reinsert. A
 * game that flips from in-progress to final, or a roster corrected after the
 * fact, both converge on the right answer without bookkeeping.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { SeasonType } from 'shared';
import { gamePoints, games, picks, pollRanks } from '../db/schema';
import type { Db } from '../lib/db';
import { pointsForGame, type ScorableGame } from './scoring';

/** The AP poll is the one the league's Top-25 bonus refers to. */
export const AP_POLL = 'AP Top 25';

export interface RecomputeResult {
  week: number;
  seasonType: SeasonType;
  /** Completed games considered. */
  gamesScored: number;
  /** Rows written — games whose winner is owned by a manager. */
  rowsWritten: number;
  pointsAwarded: number;
}

/**
 * Recompute one week's scoring rows.
 *
 * Scoped to a single (season, week, seasonType) slice because the ingest cron
 * shares the 10 ms CPU budget — a whole-season recompute would not fit.
 */
export async function recomputeWeekPoints(
  db: Db,
  season: number,
  week: number,
  seasonType: SeasonType,
): Promise<RecomputeResult> {
  const weekGames = await db
    .select({
      id: games.id,
      seasonType: games.seasonType,
      notes: games.notes,
      kind: games.kind,
      homeId: games.homeTeamId,
      awayId: games.awayTeamId,
      homePoints: games.homePoints,
      awayPoints: games.awayPoints,
      completed: games.completed,
    })
    .from(games)
    .where(
      and(eq(games.season, season), eq(games.week, week), eq(games.seasonType, seasonType)),
    )
    .all();

  const finished = weekGames.filter((game) => game.completed);

  // Ownership for this season: team id -> manager id. Picks are the only record
  // of who owns what.
  const owners = new Map<number, string>();
  for (const row of await db
    .select({ teamId: picks.teamId, userId: picks.userId })
    .from(picks)
    .where(eq(picks.seasonYear, season))
    .all()) {
    owners.set(row.teamId, row.userId);
  }

  // AP membership for *this* week specifically. The bonus depends on whether the
  // opponent was ranked when the game was played, not on where they finished.
  const rankedThisWeek = new Set(
    (
      await db
        .select({ teamId: pollRanks.teamId })
        .from(pollRanks)
        .where(
          and(
            eq(pollRanks.season, season),
            eq(pollRanks.week, week),
            eq(pollRanks.seasonType, seasonType),
            eq(pollRanks.poll, AP_POLL),
          ),
        )
        .all()
    ).map((row) => row.teamId),
  );

  const ownedTeamIds = new Set(owners.keys());
  const rows: (typeof gamePoints.$inferInsert)[] = [];

  for (const game of finished) {
    const scorable: ScorableGame = {
      seasonType: game.seasonType,
      notes: game.notes,
      homeId: game.homeId,
      awayId: game.awayId,
      homePoints: game.homePoints,
      awayPoints: game.awayPoints,
      isHomeTop25: game.homeId !== null && rankedThisWeek.has(game.homeId),
      isAwayTop25: game.awayId !== null && rankedThisWeek.has(game.awayId),
    };

    const points = pointsForGame(scorable, ownedTeamIds);
    if (points === 0) continue;

    const homeWon = (game.homePoints ?? 0) > (game.awayPoints ?? 0);
    const winnerId = homeWon ? game.homeId : game.awayId;
    const loserId = homeWon ? game.awayId : game.homeId;
    if (winnerId === null) continue;

    const userId = owners.get(winnerId);
    if (!userId) continue;

    rows.push({
      gameId: game.id,
      season,
      week,
      seasonType,
      teamId: winnerId,
      userId,
      points,
      // `kind` was resolved at ingest; carried through so the UI can label the
      // point-note pill without reclassifying.
      kind: game.kind,
      beatTop25:
        game.kind === 'regular' && loserId !== null && rankedThisWeek.has(loserId),
    });
  }

  // Replace rather than upsert: a game that stops qualifying (a correction, a
  // roster change) must lose its row, which an upsert would leave behind.
  const weekGameIds = weekGames.map((game) => game.id);
  if (weekGameIds.length > 0) {
    await db.delete(gamePoints).where(inArray(gamePoints.gameId, weekGameIds));
  }

  if (rows.length > 0) {
    await db.insert(gamePoints).values(rows);
  }

  return {
    week,
    seasonType,
    gamesScored: finished.length,
    rowsWritten: rows.length,
    pointsAwarded: rows.reduce((total, row) => total + row.points, 0),
  };
}
