import { describe, expect, it } from 'vitest';
import { classifyGame, pointsForGame, pointsForWin, ScorableGame } from './scoring';

describe('pointsForWin', () => {
  it('awards 1 for a regular-season win over an unranked team', () => {
    expect(pointsForWin('regular', false)).toBe(1);
  });

  it('awards 2 for a regular-season win over a Top 25 team', () => {
    expect(pointsForWin('regular', true)).toBe(2);
  });

  it('awards a flat 2 for a bowl win regardless of opponent rank', () => {
    expect(pointsForWin('bowl', false)).toBe(2);
    expect(pointsForWin('bowl', true)).toBe(2);
  });

  it('awards a flat 3 for conference championship and playoff wins', () => {
    expect(pointsForWin('conference_championship', true)).toBe(3);
    expect(pointsForWin('playoff_round', true)).toBe(3);
  });

  it('awards a flat 4 for the national championship', () => {
    expect(pointsForWin('national_championship', true)).toBe(4);
  });
});

describe('classifyGame', () => {
  it('classifies plain regular-season games', () => {
    expect(classifyGame({ seasonType: 'regular', notes: null })).toBe('regular');
  });

  it('classifies conference championships (regular seasonType + notes)', () => {
    expect(classifyGame({ seasonType: 'regular', notes: 'Big Ten Championship Game' }))
      .toBe('conference_championship');
  });

  it('classifies non-playoff bowls', () => {
    expect(classifyGame({ seasonType: 'postseason', notes: 'Pop-Tarts Bowl' })).toBe('bowl');
  });

  it('classifies CFP rounds hosted at bowls as playoff, not bowl', () => {
    expect(classifyGame({
      seasonType: 'postseason',
      notes: 'College Football Playoff Quarterfinal at the Rose Bowl',
    })).toBe('playoff_round');
  });

  it('classifies the title game as national championship, not playoff', () => {
    expect(classifyGame({
      seasonType: 'postseason',
      notes: 'College Football Playoff National Championship',
    })).toBe('national_championship');
  });
});

describe('pointsForGame', () => {
  const base: ScorableGame = {
    seasonType: 'regular',
    notes: null,
    homeId: 1,
    awayId: 2,
    homePoints: 31,
    awayPoints: 17,
    isHomeTop25: false,
    isAwayTop25: false,
  };

  it('scores 1 when an owned team wins', () => {
    expect(pointsForGame(base, new Set([1]))).toBe(1);
  });

  it('scores 0 when an owned team loses', () => {
    expect(pointsForGame(base, new Set([2]))).toBe(0);
  });

  it('scores 2 when the beaten opponent was Top 25 in the regular season', () => {
    expect(pointsForGame({ ...base, isAwayTop25: true }, new Set([1]))).toBe(2);
  });

  it('ignores the winner\'s own ranking', () => {
    expect(pointsForGame({ ...base, isHomeTop25: true }, new Set([1]))).toBe(1);
  });

  it('scores the winning side when a manager owns both teams', () => {
    expect(pointsForGame({ ...base, isAwayTop25: true }, new Set([1, 2]))).toBe(2);
  });

  it('scores 0 for unfinished games and ties', () => {
    expect(pointsForGame({ ...base, homePoints: null }, new Set([1]))).toBe(0);
    expect(pointsForGame({ ...base, homePoints: 21, awayPoints: 21 }, new Set([1, 2]))).toBe(0);
  });

  it('does not apply the Top 25 bonus in the postseason (bowl is flat 2)', () => {
    expect(pointsForGame(
      { ...base, seasonType: 'postseason', notes: 'Citrus Bowl', isAwayTop25: true },
      new Set([1]),
    )).toBe(2);
  });
});
