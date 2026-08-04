import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { ApiError, DraftState } from 'shared';
import {
  draftOrderRequestSchema,
  draftPickForRequestSchema,
  draftPickRequestSchema,
  draftStatusRequestSchema,
} from 'shared/requests';
import { draftOrder, picks, seasons, teams, users } from '../db/schema';
import { getDb, insertChunked, type Db } from '../lib/db';
import { resolveSeason } from '../lib/season';
import { requireAuth, requireCommissioner } from '../middleware/auth';
import { DRAFT_ROUNDS, isDraftComplete, roundForPick, slotForPick } from '../services/draft';
import type { AppEnv } from '../types';

export const draftRoutes = new Hono<AppEnv>();

/** draft_order has three columns, so chunks stay well inside D1's parameter cap. */
const ORDER_COLUMNS = 3;

/**
 * Read the whole draft in three queries.
 *
 * Every mutating route below answers with this too: a pick changes who is on the
 * clock, so returning the new state saves the client an immediate refetch of the
 * thing it just changed.
 */
async function loadDraftState(db: Db, season: number): Promise<DraftState> {
  const [seasonRow, order, pickRows] = await Promise.all([
    db
      .select({ draftStatus: seasons.draftStatus })
      .from(seasons)
      .where(eq(seasons.year, season))
      .get(),
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        avatarHue: users.avatarHue,
      })
      .from(draftOrder)
      .innerJoin(users, eq(draftOrder.userId, users.id))
      .where(eq(draftOrder.seasonYear, season))
      .orderBy(asc(draftOrder.slot))
      .all(),
    db
      .select({
        pickNumber: picks.pickNumber,
        teamId: picks.teamId,
        school: teams.school,
        userId: picks.userId,
        displayName: users.displayName,
        avatarHue: users.avatarHue,
        madeByUserId: picks.madeByUserId,
        createdAt: picks.createdAt,
      })
      .from(picks)
      .innerJoin(users, eq(picks.userId, users.id))
      .innerJoin(teams, eq(picks.teamId, teams.id))
      .where(eq(picks.seasonYear, season))
      .orderBy(asc(picks.pickNumber))
      .all(),
  ]);

  const managerCount = order.length;

  // Nobody is on the clock before an order exists or after the last pick. Both
  // cases have to be caught here: `slotForPick` divides by managerCount.
  const nextPickNumber =
    managerCount > 0 && !isDraftComplete(pickRows.length, managerCount)
      ? pickRows.length + 1
      : null;

  // Picks cannot predate the order (and the order is locked once one exists), so
  // managerCount is at least 1 wherever a round or slot is derived below.
  return {
    season,
    draftStatus: seasonRow?.draftStatus ?? 'pending',
    // The constant, not seasons.rounds: it is what the completion math above
    // uses, and a response that disagreed with that would be worse than one
    // that ignores a column nothing else reads.
    rounds: DRAFT_ROUNDS,
    managerCount,
    order,
    picks: pickRows.map((row) => ({
      pickNumber: row.pickNumber,
      round: roundForPick(row.pickNumber, managerCount),
      team: { id: row.teamId, school: row.school },
      user: { id: row.userId, displayName: row.displayName, avatarHue: row.avatarHue },
      madeByCommissioner: row.madeByUserId !== row.userId,
      createdAt: row.createdAt.getTime(),
    })),
    nextPickNumber,
    currentRound: nextPickNumber === null ? null : roundForPick(nextPickNumber, managerCount),
    onClockUser:
      nextPickNumber === null
        ? null
        : (order[slotForPick(nextPickNumber, managerCount) - 1] ?? null),
    // When the current manager went up, which is when the previous pick landed.
    onClockSince: nextPickNumber === null ? null : (pickRows.at(-1)?.createdAt.getTime() ?? null),
  };
}

/** Managers in slot order, for turn checks that don't need display fields. */
function orderedUserIds(db: Db, season: number): Promise<{ userId: string }[]> {
  return db
    .select({ userId: draftOrder.userId })
    .from(draftOrder)
    .where(eq(draftOrder.seasonYear, season))
    .orderBy(asc(draftOrder.slot))
    .all();
}

async function countPicks(db: Db, season: number): Promise<number> {
  const row = await db
    .select({ n: sql<number>`count(*)` })
    .from(picks)
    .where(eq(picks.seasonYear, season))
    .get();
  return row?.n ?? 0;
}

/**
 * Which unique index a failed insert tripped, if any.
 *
 * The indexes on `picks` are the real guard against a double-draft; the checks in
 * `recordPick` only exist to produce a better message than a stack trace. Two
 * managers submitting at once still reach the index, and that has to read as a
 * conflict rather than a server fault.
 *
 * Drizzle wraps the driver error, and its own message is the SQL text — which
 * names every column in the insert, so matching against it would identify the
 * wrong index. Only the `cause` chain carries D1's "UNIQUE constraint failed:
 * picks.season_year, picks.team_id" detail. Exported so a test can hand this the
 * real error D1 raises rather than a hand-written approximation of it.
 */
export function uniqueViolation(error: unknown): 'team' | 'other' | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (/UNIQUE constraint failed/i.test(current.message)) {
      return /team_id/i.test(current.message) ? 'team' : 'other';
    }
    current = current.cause;
  }
  return null;
}

interface PickRejection {
  error: string;
  status: 400 | 403 | 409;
}

/**
 * Validate and record one pick, for `forUserId`, submitted by `madeByUserId`.
 * Returns null on success, or the reason it was refused.
 *
 * Shared by /draft/pick and /draft/pick-for, which differ only in who the two
 * ids are: the commissioner picks on a manager's behalf, and every other rule —
 * including whose turn it is — applies unchanged.
 */
async function recordPick(
  db: Db,
  season: number,
  forUserId: string,
  madeByUserId: string,
  teamId: number,
): Promise<PickRejection | null> {
  const [seasonRow, order, picksMade, team, existingOwner] = await Promise.all([
    db
      .select({ draftStatus: seasons.draftStatus })
      .from(seasons)
      .where(eq(seasons.year, season))
      .get(),
    orderedUserIds(db, season),
    countPicks(db, season),
    db
      .select({ id: teams.id, classification: teams.classification })
      .from(teams)
      .where(eq(teams.id, teamId))
      .get(),
    db
      .select({ displayName: users.displayName })
      .from(picks)
      .innerJoin(users, eq(picks.userId, users.id))
      .where(and(eq(picks.seasonYear, season), eq(picks.teamId, teamId)))
      .get(),
  ]);

  const status = seasonRow?.draftStatus ?? 'pending';
  if (status === 'pending') {
    return { error: 'The draft has not been opened yet.', status: 409 };
  }
  if (status === 'complete') {
    return { error: 'The draft is closed.', status: 409 };
  }

  const managerCount = order.length;
  if (managerCount === 0) {
    return { error: 'The draft order has not been set yet.', status: 409 };
  }
  if (isDraftComplete(picksMade, managerCount)) {
    return { error: 'Every pick has been made.', status: 409 };
  }

  const pickNumber = picksMade + 1;
  const onClockUserId = order[slotForPick(pickNumber, managerCount) - 1]?.userId;
  if (onClockUserId !== forUserId) {
    // Whose pick this is decides the wording: the commissioner is told about a
    // manager, a manager is told about themselves.
    const onBehalf = forUserId !== madeByUserId;
    const inOrder = order.some((row) => row.userId === forUserId);
    return {
      error: inOrder
        ? onBehalf
          ? 'That manager is not on the clock.'
          : 'It is not your turn to pick.'
        : onBehalf
          ? 'That manager is not in the draft order.'
          : 'You are not in the draft order.',
      status: 403,
    };
  }

  // The pool is exactly what the ingest pulled from CFBD's /teams/fbs, so a row
  // here is FBS by construction; classification is only re-checked because CFBD
  // may omit the field, and a null must not read as "not FBS".
  if (!team || (team.classification !== null && team.classification.toLowerCase() !== 'fbs')) {
    return { error: 'That team is not in the draft pool.', status: 400 };
  }

  if (existingOwner) {
    return { error: `${existingOwner.displayName} already drafted that team.`, status: 409 };
  }

  try {
    await db.insert(picks).values({
      id: crypto.randomUUID(),
      seasonYear: season,
      pickNumber,
      userId: forUserId,
      teamId,
      madeByUserId,
      createdAt: new Date(),
    });
  } catch (error) {
    const conflict = uniqueViolation(error);
    if (conflict === 'team') {
      return { error: 'That team was just drafted by someone else.', status: 409 };
    }
    if (conflict === 'other') {
      return { error: 'Someone else just made that pick. Try again.', status: 409 };
    }
    throw error;
  }

  // Close the draft on the last pick rather than waiting for the commissioner to
  // do it by hand: leaving it `active` with no pick available would advertise a
  // draft room nobody can act in. /draft/status can still reopen it.
  if (isDraftComplete(pickNumber, managerCount)) {
    await db.update(seasons).set({ draftStatus: 'complete' }).where(eq(seasons.year, season));
  }

  return null;
}

/** Public: the draft room is browsable without signing in, like every read view. */
draftRoutes.get('/draft', async (c) => {
  const db = getDb(c.env);
  const season = await resolveSeason(db, c.env);
  return c.json(await loadDraftState(db, season));
});

draftRoutes.post('/draft/pick', requireAuth, async (c) => {
  const parsed = draftPickRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json<ApiError>({ error: 'Pick a team from the pool.' }, 400);
  }

  const user = c.get('user')!;
  const db = getDb(c.env);
  const season = await resolveSeason(db, c.env);

  const rejection = await recordPick(db, season, user.id, user.id, parsed.data.teamId);
  if (rejection) {
    return c.json<ApiError>({ error: rejection.error }, rejection.status);
  }

  return c.json(await loadDraftState(db, season));
});

/**
 * Commissioner-only: pick for a manager who can't get to a browser.
 *
 * Still bound by turn order — this is picking *on someone's behalf*, not an
 * override — and the pick records both ids so the room can show it was made by
 * the commissioner.
 */
draftRoutes.post('/draft/pick-for', requireCommissioner, async (c) => {
  const parsed = draftPickForRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json<ApiError>({ error: 'Choose a manager and a team.' }, 400);
  }

  const commissioner = c.get('user')!;
  const db = getDb(c.env);
  const season = await resolveSeason(db, c.env);

  const rejection = await recordPick(
    db,
    season,
    parsed.data.userId,
    commissioner.id,
    parsed.data.teamId,
  );
  if (rejection) {
    return c.json<ApiError>({ error: rejection.error }, rejection.status);
  }

  return c.json(await loadDraftState(db, season));
});

/** Commissioner-only: open, close, or reopen the draft. */
draftRoutes.post('/draft/status', requireCommissioner, async (c) => {
  const parsed = draftStatusRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json<ApiError>({ error: 'Draft status must be pending, active or complete.' }, 400);
  }

  const db = getDb(c.env);
  const season = await resolveSeason(db, c.env);

  const [seasonRow, orderSize] = await Promise.all([
    db.select({ year: seasons.year }).from(seasons).where(eq(seasons.year, season)).get(),
    db
      .select({ n: sql<number>`count(*)` })
      .from(draftOrder)
      .where(eq(draftOrder.seasonYear, season))
      .get(),
  ]);

  if (!seasonRow) {
    return c.json<ApiError>({ error: `Season ${season} has not been created yet.` }, 404);
  }
  // Opening a draft with no order would put nobody on the clock, which looks
  // like a broken draft room rather than a misconfiguration.
  if (parsed.data.draftStatus === 'active' && (orderSize?.n ?? 0) === 0) {
    return c.json<ApiError>({ error: 'Set the draft order before opening the draft.' }, 409);
  }

  await db
    .update(seasons)
    .set({ draftStatus: parsed.data.draftStatus })
    .where(eq(seasons.year, season));

  return c.json(await loadDraftState(db, season));
});

/**
 * Commissioner-only: replace the draft order, index 0 being slot 1.
 *
 * Sending the order as an array rather than slot/user pairs is what makes it
 * impossible to submit a sparse or duplicated set of slots.
 */
draftRoutes.put('/draft/order', requireCommissioner, async (c) => {
  const parsed = draftOrderRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json<ApiError>({ error: 'Send every manager exactly once, in slot order.' }, 400);
  }
  const { userIds } = parsed.data;

  const db = getDb(c.env);
  const season = await resolveSeason(db, c.env);

  const [seasonRow, picksMade, known] = await Promise.all([
    db.select({ year: seasons.year }).from(seasons).where(eq(seasons.year, season)).get(),
    countPicks(db, season),
    db.select({ id: users.id }).from(users).where(inArray(users.id, userIds)).all(),
  ]);

  if (!seasonRow) {
    return c.json<ApiError>({ error: `Season ${season} has not been created yet.` }, 404);
  }
  // Reordering mid-draft would retroactively change who owned which slot, i.e.
  // rewrite the picks already made.
  if (picksMade > 0) {
    return c.json<ApiError>(
      { error: 'Picks have already been made — the draft order is locked.' },
      409,
    );
  }
  // The schema already rejects duplicates, so a short count means an id that
  // isn't a manager.
  if (known.length !== userIds.length) {
    return c.json<ApiError>({ error: 'That is not a league manager.' }, 400);
  }

  await db.delete(draftOrder).where(eq(draftOrder.seasonYear, season));
  await insertChunked(
    userIds.map((userId, index) => ({ seasonYear: season, slot: index + 1, userId })),
    ORDER_COLUMNS,
    (chunk) => db.insert(draftOrder).values(chunk),
  );

  return c.json(await loadDraftState(db, season));
});
