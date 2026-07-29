/**
 * League domain vocabulary shared by the Worker and the Angular client.
 *
 * Point values are NOT defined here — they live only in
 * `api/src/services/scoring.ts`, which is the single source of truth. This file
 * carries the labels and shapes both sides need to talk about scoring.
 */

/** How a game counts for scoring. Resolved at ingest and stored on `games.kind`. */
export type GameKind =
  | 'regular'
  | 'conference_championship'
  | 'bowl'
  | 'playoff_round'
  | 'national_championship';

export type SeasonType = 'regular' | 'postseason';

export type DraftStatus = 'pending' | 'active' | 'complete';

/** Rounds in the snake draft; each manager ends with this many teams. */
export const DRAFT_ROUNDS = 10;

/** Short labels for the point-note pill on scoreboard cards. */
export const GAME_KIND_LABEL: Record<GameKind, string> = {
  regular: 'WIN',
  conference_championship: 'CONF TITLE',
  bowl: 'BOWL WIN',
  playoff_round: 'PLAYOFF WIN',
  national_championship: 'NATTY',
};

/** oklch avatar color per the design handoff. Text on top is always #07080B. */
export function avatarColor(hue: number): string {
  return `oklch(0.78 0.14 ${hue})`;
}

export function initials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
