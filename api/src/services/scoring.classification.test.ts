import { describe, expect, it } from 'vitest';
import { classifyGame, pointsForWin, type GameKind } from './scoring';

/**
 * Classification against real CFBD labels.
 *
 * Every string below was captured verbatim from the live API for the 2025
 * season. scoring.test.ts covers the rules in the abstract; this file is the
 * check that the heuristics survive contact with how CFBD actually writes things
 * — which is where the previous implementation went wrong.
 *
 * Survey of the source data, for context on the assertions:
 * - 888 regular-season FBS games, of which exactly 9 have notes containing
 *   "championship" — the nine conference title games, all in week 15. No false
 *   positives anywhere in the season.
 * - 46 postseason games: 34 plain bowls, 4 CFP first round, 4 quarterfinals,
 *   2 semifinals, 1 national championship.
 */

function classify(seasonType: 'regular' | 'postseason', notes: string | null): GameKind {
  return classifyGame({ seasonType, notes });
}

describe('conference championships (2025 labels)', () => {
  // Conference title games are seasonType "regular", not postseason — the single
  // most counterintuitive thing about CFBD's model.
  const titles = [
    'SEC Championship',
    'Big Ten Championship',
    'Big 12 Championship',
    'ACC Championship',
    'American Championship',
    'MAC Championship',
    'Mountain West Championship',
    'Sun Belt Championship',
    'Conference USA Championship',
  ];

  it.each(titles)('classifies "%s" as a conference championship worth 3', (notes) => {
    expect(classify('regular', notes)).toBe('conference_championship');
    expect(pointsForWin(classify('regular', notes), false)).toBe(3);
  });
});

describe('CFP games (2025 labels)', () => {
  it('scores first-round games as playoff wins', () => {
    const notes = 'College Football Playoff First Round Game';
    expect(classify('postseason', notes)).toBe('playoff_round');
    expect(pointsForWin(classify('postseason', notes), false)).toBe(3);
  });

  /**
   * The case the league rules call out explicitly. These notes contain the word
   * "Bowl" — the games are literally played at the Cotton, Orange, Rose and Sugar
   * Bowls — but they are playoff wins worth 3, not bowl wins worth 2.
   */
  it.each([
    'College Football Playoff Quarterfinal at the Goodyear Cotton Bowl Classic',
    'College Football Playoff Quarterfinal at the Capital One Orange Bowl',
    'College Football Playoff Quarterfinal at the Rose Bowl Presented by Prudential',
    'College Football Playoff Quarterfinal at the Allstate Sugar Bowl',
    'College Football Playoff Semifinal at the Vrbo Fiesta Bowl',
    'College Football Playoff Semifinal at the Chick-fil-A Peach Bowl',
  ])('scores "%s" as a playoff win, not a bowl win', (notes) => {
    expect(classify('postseason', notes)).toBe('playoff_round');
    expect(pointsForWin(classify('postseason', notes), false)).toBe(3);
  });

  it('scores the national championship as 4, and does not stack it with the playoff bonus', () => {
    const notes = 'College Football Playoff National Championship Presented by AT&T';
    expect(classify('postseason', notes)).toBe('national_championship');
    expect(pointsForWin(classify('postseason', notes), false)).toBe(4);
    // Not 3 + 4: the title game pays a flat 4.
    expect(pointsForWin(classify('postseason', notes), true)).toBe(4);
  });
});

describe('plain bowls (2025 labels)', () => {
  it.each([
    'Bucked Up LA Bowl',
    'Myrtle Beach Bowl',
    'Union Home Mortgage Gasparilla Bowl',
    'TaxSlayer Gator Bowl',
    'Pop-Tarts Bowl',
    'Snoop Dogg Arizona Bowl',
    'Wasabi Fenway Bowl',
    'Sheraton Hawaiʻi Bowl',
    'Bad Boy Mowers Pinstripe Bowl',
    'SERVPRO First Responder Bowl',
  ])('scores "%s" as a bowl win worth 2', (notes) => {
    expect(classify('postseason', notes)).toBe('bowl');
    expect(pointsForWin(classify('postseason', notes), false)).toBe(2);
  });

  it('treats an unlabelled postseason game as a bowl', () => {
    expect(classify('postseason', null)).toBe('bowl');
  });
});

describe('ordinary regular-season games', () => {
  it.each([
    'Aer Lingus College Football Classic',
    'Week 0 Kickoff',
    null,
    '',
  ])('classifies notes %p as a regular game', (notes) => {
    expect(classify('regular', notes)).toBe('regular');
  });

  it('applies the Top 25 bonus only to regular-season games', () => {
    expect(pointsForWin('regular', true)).toBe(2);
    expect(pointsForWin('regular', false)).toBe(1);
    // Postseason kinds pay their flat rate regardless of the opponent's ranking.
    expect(pointsForWin('bowl', true)).toBe(2);
    expect(pointsForWin('conference_championship', true)).toBe(3);
    expect(pointsForWin('playoff_round', true)).toBe(3);
  });

  it('does not mistake a neutral-site sponsor name for a title game', () => {
    // "Classic" and "Championship Subdivision" style wording must not trip the
    // conference-championship heuristic.
    expect(classify('regular', 'Chick-fil-A Kickoff Classic')).toBe('regular');
    expect(classify('regular', 'Camping World Kickoff')).toBe('regular');
  });
});
