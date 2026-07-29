import { describe, expect, it } from 'vitest';
import {
  advance,
  CALENDAR_TTL_MS,
  chooseStage,
  INITIAL_CURSOR,
  isInSeasonWindow,
  isLikelyGameWindow,
  resolveCurrentWeek,
  TEAMS_TTL_MS,
  type IngestCursor,
} from './plan';

/**
 * Freshness has to be relative to the clock each test uses, not the real one —
 * the fixtures are dated in September and would otherwise read as weeks stale.
 */
function freshAt(now: Date) {
  return { teamsSyncedAt: now.getTime() - 1_000, calendarSyncedAt: now.getTime() - 1_000 };
}

describe('isInSeasonWindow', () => {
  it('covers August through January', () => {
    for (const month of [7, 8, 9, 10, 11, 0]) {
      expect(isInSeasonWindow(new Date(Date.UTC(2026, month, 15)))).toBe(true);
    }
  });

  it('excludes the offseason', () => {
    for (const month of [1, 2, 3, 4, 5, 6]) {
      expect(isInSeasonWindow(new Date(Date.UTC(2026, month, 15)))).toBe(false);
    }
  });
});

describe('isLikelyGameWindow', () => {
  it('includes Saturday afternoon and evening UTC', () => {
    // 2026-09-05 is a Saturday.
    expect(isLikelyGameWindow(new Date('2026-09-05T18:00:00Z'))).toBe(true);
  });

  it('includes the small hours of Sunday, when west-coast games are still running', () => {
    expect(isLikelyGameWindow(new Date('2026-09-06T04:00:00Z'))).toBe(true);
  });

  it('excludes Saturday morning UTC, before any kickoff', () => {
    expect(isLikelyGameWindow(new Date('2026-09-05T09:00:00Z'))).toBe(false);
  });

  it('excludes Tuesday', () => {
    expect(isLikelyGameWindow(new Date('2026-09-08T18:00:00Z'))).toBe(false);
  });
});

describe('chooseStage', () => {
  const now = new Date('2026-09-08T18:00:00Z'); // Tuesday, not a game window

  it('syncs teams first when they have never been synced', () => {
    expect(
      chooseStage(INITIAL_CURSOR, { teamsSyncedAt: null, calendarSyncedAt: null }, now),
    ).toBe('teams');
  });

  it('syncs teams again once the TTL lapses', () => {
    const stale = now.getTime() - TEAMS_TTL_MS - 1;
    expect(
      chooseStage(INITIAL_CURSOR, { teamsSyncedAt: stale, calendarSyncedAt: now.getTime() }, now),
    ).toBe('teams');
  });

  it('refreshes the calendar before any per-week work', () => {
    const stale = now.getTime() - CALENDAR_TTL_MS - 1;
    expect(
      chooseStage(INITIAL_CURSOR, { teamsSyncedAt: now.getTime(), calendarSyncedAt: stale }, now),
    ).toBe('calendar');
  });

  it('rotates games, rankings and points outside a game window', () => {
    const seen = [0, 1, 2].map((rotation) =>
      chooseStage({ ...INITIAL_CURSOR, rotation }, freshAt(now), now),
    );
    expect(seen).toEqual(['games', 'rankings', 'points']);
  });

  it('drops rankings during a game window so scores refresh twice as often', () => {
    const saturday = new Date('2026-09-05T18:00:00Z');
    const seen = [0, 1, 2, 3].map((rotation) =>
      chooseStage({ ...INITIAL_CURSOR, rotation }, freshAt(saturday), saturday),
    );
    expect(seen).toEqual(['games', 'points', 'games', 'points']);
    expect(seen).not.toContain('rankings');
  });
});

describe('advance', () => {
  it('cycles the rotation without moving the week', () => {
    let cursor: IngestCursor = { week: 4, seasonType: 'regular', rotation: 0 };
    const rotations = new Set<number>();
    for (let i = 0; i < 12; i += 1) {
      cursor = advance(cursor);
      rotations.add(cursor.rotation);
      expect(cursor.week).toBe(4);
      expect(cursor.seasonType).toBe('regular');
    }
    // Divisible by both rotation lengths (2 and 3), so neither drifts.
    expect(rotations.size).toBe(6);
  });
});

describe('resolveCurrentWeek', () => {
  const weeks = [
    { week: 1, seasonType: 'regular' as const, firstGameStart: new Date('2026-08-29T16:00:00Z') },
    { week: 2, seasonType: 'regular' as const, firstGameStart: new Date('2026-09-05T16:00:00Z') },
    { week: 3, seasonType: 'regular' as const, firstGameStart: new Date('2026-09-12T16:00:00Z') },
  ];

  it('returns null before the season opens', () => {
    expect(resolveCurrentWeek(weeks, new Date('2026-08-01T00:00:00Z'))).toBeNull();
  });

  it('stays on the week in progress rather than jumping ahead', () => {
    // Mid-week: week 2 has started, week 3 has not.
    expect(resolveCurrentWeek(weeks, new Date('2026-09-09T12:00:00Z'))).toEqual({
      week: 2,
      seasonType: 'regular',
    });
  });

  it('moves on the moment the next week kicks off', () => {
    expect(resolveCurrentWeek(weeks, new Date('2026-09-12T16:00:00Z'))).toEqual({
      week: 3,
      seasonType: 'regular',
    });
  });

  it('crosses into the postseason', () => {
    const withBowls = [
      ...weeks,
      {
        week: 1,
        seasonType: 'postseason' as const,
        firstGameStart: new Date('2026-12-19T17:00:00Z'),
      },
    ];
    expect(resolveCurrentWeek(withBowls, new Date('2026-12-20T00:00:00Z'))).toEqual({
      week: 1,
      seasonType: 'postseason',
    });
  });

  it('ignores weeks with no scheduled start', () => {
    const partial = [
      { week: 1, seasonType: 'regular' as const, firstGameStart: null },
      { week: 2, seasonType: 'regular' as const, firstGameStart: null },
    ];
    expect(resolveCurrentWeek(partial, new Date('2026-10-01T00:00:00Z'))).toBeNull();
  });
});
