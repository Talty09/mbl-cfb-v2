import { beforeEach, describe, expect, it } from 'vitest';
import { syncState } from '../db/schema';
import { getDb } from './db';
import { CALENDAR_KEY, readCalendar, resolveSeason } from './season';
import { migrate, testEnv } from '../test/helpers';
import { seasons } from '../db/schema';

async function writeCalendarCursor(cursor: unknown): Promise<void> {
  await getDb(testEnv)
    .insert(syncState)
    .values({ key: CALENDAR_KEY, cursor: JSON.stringify(cursor), lastRunAt: new Date() })
    .onConflictDoUpdate({
      target: syncState.key,
      set: { cursor: JSON.stringify(cursor) },
    });
}

describe('resolveSeason', () => {
  beforeEach(migrate);

  it('falls back to the CURRENT_SEASON var on an empty database', async () => {
    // A fresh deploy must answer requests rather than 500 before seeding.
    expect(await resolveSeason(getDb(testEnv), testEnv)).toBe(
      Number.parseInt(testEnv.CURRENT_SEASON, 10),
    );
  });

  it('prefers the season flagged current', async () => {
    await getDb(testEnv)
      .insert(seasons)
      .values([
        { year: 2025, isCurrent: false },
        { year: 2026, isCurrent: true },
      ]);
    expect(await resolveSeason(getDb(testEnv), testEnv)).toBe(2026);
  });
});

describe('readCalendar', () => {
  beforeEach(migrate);

  it('returns null before the ingest has ever run', async () => {
    expect(await readCalendar(getDb(testEnv), 2026)).toBeNull();
  });

  it('returns the stored position for the matching season', async () => {
    await writeCalendarCursor({ season: 2026, week: 7, seasonType: 'regular' });
    expect(await readCalendar(getDb(testEnv), 2026)).toEqual({
      season: 2026,
      week: 7,
      seasonType: 'regular',
    });
  });

  /**
   * Regression: the cursor originally carried no season, so a position left over
   * from the previous year read as current. At the rollover that would point the
   * per-week ingest stages at the wrong (season, week) and make the header
   * advertise last season's final week.
   */
  it('ignores a cursor belonging to a different season', async () => {
    await writeCalendarCursor({ season: 2025, week: 1, seasonType: 'postseason' });
    expect(await readCalendar(getDb(testEnv), 2026)).toBeNull();
  });

  it('ignores a cursor with no season at all', async () => {
    await writeCalendarCursor({ week: 1, seasonType: 'postseason' });
    expect(await readCalendar(getDb(testEnv), 2026)).toBeNull();
  });

  it('treats a malformed cursor as no current week rather than throwing', async () => {
    await getDb(testEnv)
      .insert(syncState)
      .values({ key: CALENDAR_KEY, cursor: 'not json', lastRunAt: new Date() });
    await expect(readCalendar(getDb(testEnv), 2026)).resolves.toBeNull();
  });

  it('defaults an unrecognized season type to regular', async () => {
    await writeCalendarCursor({ season: 2026, week: 3, seasonType: 'spring' });
    expect(await readCalendar(getDb(testEnv), 2026)).toMatchObject({ seasonType: 'regular' });
  });
});
