/**
 * D1 (SQLite) schema for Most Baller League.
 *
 * Conventions:
 * - Our own rows get text UUID primary keys; rows mirrored from the College
 *   Football Data API keep their CFBD integer ids so ingest is a plain upsert.
 * - Timestamps are epoch-milliseconds integers (`timestamp_ms`), not ISO text —
 *   they sort and range-scan correctly in SQLite without collation surprises.
 * - Ownership of a team has exactly one source of truth: `picks`. There is no
 *   separate roster table to drift out of sync; a roster is a query over picks.
 */

import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/** Commissioner-seeded login accounts; season participation comes from draft_order. */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  /** Login identifier, always stored lowercased (e.g. "tom", "josh.bozym"). */
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  /** Hue (0-360) for the manager's oklch avatar color, per the design handoff. */
  avatarHue: integer('avatar_hue').notNull().default(0),
  isCommissioner: integer('is_commissioner', { mode: 'boolean' })
    .notNull()
    .default(false),
  /** `pbkdf2-sha256$<iterations>$<salt-b64url>$<derived-b64url>`. Null = no login yet. */
  passwordHash: text('password_hash'),
  /** True until the manager sets their own password, replacing the one-time issued passphrase. */
  mustChangePassword: integer('must_change_password', { mode: 'boolean' })
    .notNull()
    .default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/**
 * Opaque session tokens. We store only the SHA-256 of the token, so a leaked
 * database dump cannot be replayed as a login. Chosen over JWTs because
 * verification is a single indexed read (negligible against the 10 ms
 * free-tier CPU budget), revocation is a DELETE, and there is no signing
 * secret to rotate.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    /** Sliding; also powers the "online now" count on the Trash Talk header. */
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    index('sessions_last_seen_idx').on(t.lastSeenAt),
  ],
);

/**
 * One row per league year. There are no pick-clock columns: the draft is
 * asynchronous and runs over days, with the commissioner nudging managers
 * out of band.
 */
export const seasons = sqliteTable('seasons', {
  year: integer('year').primaryKey(),
  draftStatus: text('draft_status', {
    enum: ['pending', 'active', 'complete'],
  })
    .notNull()
    .default('pending'),
  rounds: integer('rounds').notNull().default(10),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
});

/**
 * Draft order: slot 1..N per season, set (and randomizable) by the
 * commissioner. Snake order is derived, never stored — see
 * `services/draft.ts#slotForPick`.
 */
export const draftOrder = sqliteTable(
  'draft_order',
  {
    seasonYear: integer('season_year')
      .notNull()
      .references(() => seasons.year, { onDelete: 'cascade' }),
    slot: integer('slot').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.seasonYear, t.slot] }),
    uniqueIndex('draft_order_season_user_unq').on(t.seasonYear, t.userId),
  ],
);

/**
 * Every pick made, and the only record of who owns which team.
 *
 * The two unique indexes are the real integrity guarantee, not the
 * application checks in front of them: `(season_year, team_id)` enforces
 * league-wide exclusive ownership and `(season_year, pick_number)` prevents
 * two managers landing the same slot in a race.
 */
export const picks = sqliteTable(
  'picks',
  {
    id: text('id').primaryKey(),
    seasonYear: integer('season_year')
      .notNull()
      .references(() => seasons.year, { onDelete: 'cascade' }),
    /** 1-based overall pick (1..rounds*managers). Round is derived. */
    pickNumber: integer('pick_number').notNull(),
    /** The manager who owns the team. */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id),
    /** Differs from userId when the commissioner picked on someone's behalf. */
    madeByUserId: text('made_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('picks_season_pick_unq').on(t.seasonYear, t.pickNumber),
    uniqueIndex('picks_season_team_unq').on(t.seasonYear, t.teamId),
    index('picks_season_user_idx').on(t.seasonYear, t.userId),
  ],
);

/** FBS teams, mirrored from CFBD so the draft pool never hits a third party. */
export const teams = sqliteTable(
  'teams',
  {
    /** CFBD team id. */
    id: integer('id').primaryKey(),
    school: text('school').notNull(),
    mascot: text('mascot'),
    abbreviation: text('abbreviation'),
    conference: text('conference'),
    division: text('division'),
    classification: text('classification'),
    color: text('color'),
    altColor: text('alt_color'),
    logoUrl: text('logo_url'),
  },
  (t) => [index('teams_conference_idx').on(t.conference)],
);

/**
 * Games, mirrored from CFBD.
 *
 * `homeTeamId`/`awayTeamId` deliberately have NO foreign key to `teams`: FBS
 * schools play FCS opponents that we never ingest, and a FK would reject those
 * rows outright.
 *
 * `kind` is `classifyGame()`'s verdict, resolved once at ingest rather than on
 * every read — this is where the "CFP quarterfinal hosted at the Rose Bowl is
 * a playoff win, not a bowl win" distinction gets settled.
 */
export const games = sqliteTable(
  'games',
  {
    /** CFBD game id. */
    id: integer('id').primaryKey(),
    season: integer('season').notNull(),
    week: integer('week').notNull(),
    seasonType: text('season_type', { enum: ['regular', 'postseason'] }).notNull(),
    startDate: integer('start_date', { mode: 'timestamp_ms' }),
    completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
    homeTeamId: integer('home_team_id'),
    awayTeamId: integer('away_team_id'),
    homePoints: integer('home_points'),
    awayPoints: integer('away_points'),
    /** CFBD's free-text label, e.g. "Big Ten Championship Game". Drives `kind`. */
    notes: text('notes'),
    kind: text('kind', {
      enum: [
        'regular',
        'conference_championship',
        'bowl',
        'playoff_round',
        'national_championship',
      ],
    }).notNull(),
    venue: text('venue'),
  },
  (t) => [
    index('games_season_week_idx').on(t.season, t.week),
    index('games_season_home_idx').on(t.season, t.homeTeamId),
    index('games_season_away_idx').on(t.season, t.awayTeamId),
    index('games_season_start_idx').on(t.season, t.startDate),
  ],
);

/**
 * AP Top 25 membership per week. The Top-25 bonus depends on whether the
 * opponent was ranked *in the week the game was played*, so this is keyed by
 * week and never collapsed to a single season-wide set.
 */
export const pollRanks = sqliteTable(
  'poll_ranks',
  {
    season: integer('season').notNull(),
    week: integer('week').notNull(),
    seasonType: text('season_type', { enum: ['regular', 'postseason'] })
      .notNull()
      .default('regular'),
    /** e.g. "AP Top 25". Stored so other polls can be ingested without a migration. */
    poll: text('poll').notNull(),
    teamId: integer('team_id').notNull(),
    rank: integer('rank').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.season, t.seasonType, t.week, t.poll, t.teamId] }),
    index('poll_ranks_lookup_idx').on(t.season, t.week, t.teamId),
  ],
);

/**
 * Materialized scoring output: one row per completed game whose winner is
 * owned by a manager. Nothing here is authoritative — it is recomputed
 * idempotently from `games` + `picks` + `poll_ranks` each time a week is
 * ingested.
 *
 * This table exists so the point values stay in tested TypeScript
 * (`services/scoring.ts`) instead of being restated as a SQL CASE expression.
 * Standings then reduce to `SUM(points) GROUP BY user_id`.
 */
export const gamePoints = sqliteTable(
  'game_points',
  {
    /** CFBD game id; one scoring row per game (only the winner scores). */
    gameId: integer('game_id').primaryKey(),
    season: integer('season').notNull(),
    week: integer('week').notNull(),
    seasonType: text('season_type', { enum: ['regular', 'postseason'] }).notNull(),
    /** The winning team, which is by construction one the manager owns. */
    teamId: integer('team_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    points: integer('points').notNull(),
    kind: text('kind').notNull(),
    /** True when the 2-point regular-season Top-25 bonus applied. */
    beatTop25: integer('beat_top25', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    index('game_points_user_idx').on(t.season, t.userId),
    index('game_points_week_idx').on(t.season, t.week),
  ],
);

/**
 * Trash Talk. The integer autoincrement id is deliberate: it gives the client
 * a monotonic cursor for `GET /api/chat?since=<id>` and lets `/api/pulse`
 * detect new messages with a single `MAX(id)`.
 */
export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seasonYear: integer('season_year')
      .notNull()
      .references(() => seasons.year, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('chat_season_created_idx').on(t.seasonYear, t.createdAt)],
);

/**
 * Cron bookkeeping. The ingest cannot fetch a whole season inside a 10 ms CPU
 * budget, so each run handles one slice and advances a cursor kept here.
 * `lastRunAt`/`lastError` also surface as "updated N min ago" in the UI.
 */
export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  cursor: text('cursor'),
  lastRunAt: integer('last_run_at', { mode: 'timestamp_ms' }),
  lastError: text('last_error'),
});
