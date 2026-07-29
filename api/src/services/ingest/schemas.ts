/**
 * Shapes of the CFBD responses we ingest.
 *
 * Verified against real captured responses, not guessed. Worth recording what
 * they actually are, because the field naming is not uniform across the API and
 * stale interfaces led the previous implementation astray:
 *
 * - `/games`, `/calendar`, `/rankings` and `/teams/fbs` all return **camelCase**
 *   (`homeId`, `seasonType`, `startDate`, `firstGameStart`).
 * - `/rankings` ranks carry `teamId`, so poll membership needs no name matching.
 * - `/rankings` returns every poll CFBD tracks — Coaches, FCS, Division II and
 *   III — so the AP filter is not optional.
 *
 * zod objects strip unknown keys by default, so CFBD adding fields is harmless;
 * only a removed or retyped field we depend on will fail, which is the point.
 */

import { z } from 'zod';
import type { SeasonType } from 'shared';

/**
 * CFBD exposes season types beyond the two the league scores (`allstar`,
 * `spring`). Anything else is skipped rather than guessed at.
 */
export function normalizeSeasonType(value: string | null | undefined): SeasonType | null {
  if (value === 'regular' || value === 'postseason') return value;
  return null;
}

/** Parse a CFBD ISO timestamp, tolerating nulls and unparseable values. */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const cfbdTeamSchema = z.object({
  id: z.number().int(),
  school: z.string(),
  mascot: z.string().nullish(),
  abbreviation: z.string().nullish(),
  conference: z.string().nullish(),
  division: z.string().nullish(),
  classification: z.string().nullish(),
  color: z.string().nullish(),
  alternateColor: z.string().nullish(),
  logos: z.array(z.string()).nullish(),
});
export const cfbdTeamsSchema = z.array(cfbdTeamSchema);
export type CfbdTeam = z.infer<typeof cfbdTeamSchema>;

export const cfbdCalendarWeekSchema = z.object({
  season: z.number().int(),
  week: z.number().int(),
  seasonType: z.string(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  firstGameStart: z.string().nullish(),
  lastGameStart: z.string().nullish(),
});
export const cfbdCalendarSchema = z.array(cfbdCalendarWeekSchema);

export const cfbdGameSchema = z.object({
  id: z.number().int(),
  season: z.number().int(),
  week: z.number().int(),
  seasonType: z.string(),
  startDate: z.string().nullish(),
  completed: z.boolean().nullish(),
  venue: z.string().nullish(),
  homeId: z.number().int().nullish(),
  homeTeam: z.string().nullish(),
  homeClassification: z.string().nullish(),
  homePoints: z.number().nullish(),
  awayId: z.number().int().nullish(),
  awayTeam: z.string().nullish(),
  awayClassification: z.string().nullish(),
  awayPoints: z.number().nullish(),
  /** Free-text label. This is what distinguishes a CFP game from a plain bowl. */
  notes: z.string().nullish(),
});
export const cfbdGamesSchema = z.array(cfbdGameSchema);
export type CfbdGame = z.infer<typeof cfbdGameSchema>;

export const cfbdRankSchema = z.object({
  rank: z.number().int(),
  teamId: z.number().int().nullish(),
  school: z.string(),
  conference: z.string().nullish(),
});

export const cfbdPollSchema = z.object({
  poll: z.string(),
  ranks: z.array(cfbdRankSchema),
});

export const cfbdRankingWeekSchema = z.object({
  season: z.number().int(),
  seasonType: z.string(),
  week: z.number().int().nullish(),
  polls: z.array(cfbdPollSchema),
});
export const cfbdRankingsSchema = z.array(cfbdRankingWeekSchema);
