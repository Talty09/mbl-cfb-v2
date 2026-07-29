/**
 * MBL scoring rules — the single source of truth for point values.
 * See CLAUDE.md "League Rules". Any conflict with older code or the design
 * handoff resolves in favor of this table:
 *
 *   Win (any game)                                  1
 *   Win vs. AP Top 25 team (regular season only)    2
 *   Bowl game win (non-playoff bowls)               2
 *   Conference championship win                     3
 *   Playoff win (incl. CFP games hosted at bowls)   3
 *   National championship win                       4
 *
 * Losses and ties are always 0. Bonuses do not stack.
 */

export type GameKind =
  | 'regular'
  | 'conference_championship'
  | 'bowl'
  | 'playoff_round'
  | 'national_championship';

export function pointsForWin(kind: GameKind, opponentWasTop25: boolean): number {
  switch (kind) {
    case 'regular':
      return opponentWasTop25 ? 2 : 1;
    case 'bowl':
      return 2;
    case 'conference_championship':
      return 3;
    case 'playoff_round':
      return 3;
    case 'national_championship':
      return 4;
  }
}

/** The subset of a CFBD game needed to classify it. */
export interface ClassifiableGame {
  seasonType: string; // 'regular' | 'postseason'
  notes?: string | null;
}

/**
 * Classify a CFBD game into an MBL game kind.
 *
 * Heuristics based on CFBD conventions:
 * - Conference championship games are seasonType 'regular' with notes like
 *   "Big Ten Championship Game".
 * - CFP games are seasonType 'postseason' with notes containing
 *   "College Football Playoff" (first round, and quarters/semis hosted at
 *   named bowls); the title game notes contain "National Championship".
 * - Everything else in the postseason is a regular bowl.
 *
 * TODO: verify against live CFBD data for the current season before the
 * postseason starts — note formats have shifted between years.
 */
export function classifyGame(game: ClassifiableGame): GameKind {
  const notes = (game.notes ?? '').toLowerCase();

  if (game.seasonType === 'postseason') {
    if (notes.includes('national championship')) return 'national_championship';
    if (notes.includes('college football playoff') || notes.includes('cfp')) {
      return 'playoff_round';
    }
    return 'bowl';
  }

  if (notes.includes('championship')) return 'conference_championship';
  return 'regular';
}

/** The subset of a game needed to score it for one owned team. */
export interface ScorableGame extends ClassifiableGame {
  homeId: number | null;
  awayId: number | null;
  homePoints: number | null;
  awayPoints: number | null;
  /** AP Top 25 membership for the week the game was played */
  isHomeTop25?: boolean;
  isAwayTop25?: boolean;
}

/**
 * Points a manager earns from a single game given the set of team ids they
 * own. Handles the both-teams-owned case (the winning side still scores).
 * Unfinished games (null scores) earn 0.
 */
export function pointsForGame(game: ScorableGame, ownedTeamIds: Set<number>): number {
  if (game.homePoints === null || game.awayPoints === null) return 0;
  if (game.homePoints === game.awayPoints) return 0;

  const homeWon = game.homePoints > game.awayPoints;
  const winnerId = homeWon ? game.homeId : game.awayId;
  if (winnerId === null || !ownedTeamIds.has(winnerId)) return 0;

  const loserWasTop25 = homeWon ? !!game.isAwayTop25 : !!game.isHomeTop25;
  return pointsForWin(classifyGame(game), loserWasTop25);
}
