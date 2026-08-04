import { and, asc, desc, eq, gt, gte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { ApiError, ChatMessageView, ChatResponse } from 'shared';
import { chatPostRequestSchema } from 'shared/requests';
import { chatMessages, sessions, users } from '../db/schema';
import { getDb, type Db } from '../lib/db';
import { resolveSeason } from '../lib/season';
import { ONLINE_WINDOW_MS } from '../lib/session';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

/** A page of Trash Talk. Roughly two screens of scrollback. */
const DEFAULT_LIMIT = 100;

/** Ceiling on `?limit=`, so one request can never scan the whole season. */
const MAX_LIMIT = 200;

export const chatRoutes = new Hono<AppEnv>();

/**
 * Parse a query param that must be a whole number: `undefined` when absent,
 * `null` when present but malformed.
 *
 * Malformed params are rejected with a 400 rather than coerced, so a client bug
 * shows up as a broken request instead of silently returning the wrong page of
 * messages. The digit-count bound keeps the result inside safe-integer range.
 */
function wholeNumberParam(raw: string | undefined): number | null | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d{1,15}$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
}

/**
 * One page of messages with their authors, in chronological order.
 *
 * Authors are joined in rather than looked up per message: the free plan allows
 * 50 D1 queries per invocation, which a 100-message page would blow through on
 * its own.
 */
async function readPage(db: Db, season: number, since: number | undefined, limit: number) {
  const columns = {
    id: chatMessages.id,
    body: chatMessages.body,
    createdAt: chatMessages.createdAt,
    userId: users.id,
    displayName: users.displayName,
    avatarHue: users.avatarHue,
  };
  const inSeason = eq(chatMessages.seasonYear, season);

  if (since !== undefined) {
    // The polling path: strictly newer than the client's cursor, so the message
    // it already has is never re-sent.
    return db
      .select(columns)
      .from(chatMessages)
      .innerJoin(users, eq(chatMessages.userId, users.id))
      .where(and(inSeason, gt(chatMessages.id, since)))
      .orderBy(asc(chatMessages.id))
      .limit(limit)
      .all();
  }

  // First load: the *newest* page, which means selecting descending and flipping
  // it. Ascending with a limit would return the oldest messages in the season.
  const newestFirst = await db
    .select(columns)
    .from(chatMessages)
    .innerJoin(users, eq(chatMessages.userId, users.id))
    .where(inSeason)
    .orderBy(desc(chatMessages.id))
    .limit(limit)
    .all();

  return newestFirst.reverse();
}

/** Distinct managers seen recently — the green dot in the chat header. */
async function countOnline(db: Db): Promise<number> {
  const row = await db
    .select({ n: sql<number>`count(distinct ${sessions.userId})` })
    .from(sessions)
    .where(gte(sessions.lastSeenAt, new Date(Date.now() - ONLINE_WINDOW_MS)))
    .get();

  return row?.n ?? 0;
}

/**
 * Read the league chat. Public: the design handoff gates writes, not reads, so a
 * guest browsing without signing in still sees the trash talk.
 *
 * `?since=<id>` is the polling path — the client watches `/api/pulse` for the max
 * chat id and only calls this when it moves.
 */
chatRoutes.get('/chat', async (c) => {
  const since = wholeNumberParam(c.req.query('since'));
  const requestedLimit = wholeNumberParam(c.req.query('limit'));
  if (since === null || requestedLimit === null || requestedLimit === 0) {
    return c.json<ApiError>(
      { error: 'since and limit must be whole numbers, and limit at least 1.' },
      400,
    );
  }

  const db = getDb(c.env);
  const season = await resolveSeason(db, c.env);
  const limit = Math.min(requestedLimit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const [rows, onlineCount] = await Promise.all([
    readPage(db, season, since, limit),
    countOnline(db),
  ]);

  return c.json<ChatResponse>({
    messages: rows.map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.createdAt.getTime(),
      user: { id: row.userId, displayName: row.displayName, avatarHue: row.avatarHue },
    })),
    onlineCount,
  });
});

/**
 * Post to the league chat, as the signed-in manager for the current season.
 *
 * Returns the created message so the sender sees it immediately instead of
 * waiting up to a poll interval for their own words to appear.
 */
chatRoutes.post('/chat', requireAuth, async (c) => {
  const parsed = chatPostRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json<ApiError>({ error: 'Say something, up to 2000 characters.' }, 400);
  }
  // Trimmed by the schema, so a body of spaces has already been rejected above.
  const { body } = parsed.data;

  const user = c.get('user')!;
  const db = getDb(c.env);
  const season = await resolveSeason(db, c.env);
  const createdAt = new Date();

  const inserted = await db
    .insert(chatMessages)
    .values({ seasonYear: season, userId: user.id, body, createdAt })
    .returning({ id: chatMessages.id })
    .get();

  return c.json<ChatMessageView>(
    {
      id: inserted.id,
      body,
      createdAt: createdAt.getTime(),
      user: { id: user.id, displayName: user.displayName, avatarHue: user.avatarHue },
    },
    201,
  );
});
