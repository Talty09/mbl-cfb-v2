import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { DraftState } from 'shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { draftOrder, picks, seasons, teams } from '../db/schema';
import { getDb, insertChunked } from '../lib/db';
import { createSession } from '../lib/session';
import { attachSession } from '../middleware/auth';
import { migrate, SEASON, seedManagers, testEnv } from '../test/helpers';
import type { AppEnv } from '../types';
import { draftRoutes, uniqueViolation } from './draft';

/**
 * The routes under test, mounted the way app.ts mounts every other router:
 * `attachSession` in front and a JSON 500 behind. Assembled here rather than
 * imported from app.ts so the suite tests the router itself and doesn't depend on
 * it having been wired up yet.
 */
const app = new Hono<AppEnv>().basePath('/api');
app.use('*', attachSession);
app.route('/', draftRoutes);
app.onError((_error, c) => c.json({ error: 'Internal error' }, 500));

/** tom is the commissioner and, by default, holds slot 1. */
const MANAGERS = ['tom', 'zac', 'josh', 'nick', 'ryan', 'matt', 'dan', 'pat', 'sean', 'luke', 'will'];
const ids = MANAGERS.map((name) => `usr_${name}`);
const COMMISSIONER = 'usr_tom';

/** 130 FBS teams — enough for a full 110-pick draft with some left undrafted. */
const FBS_TEAMS = Array.from({ length: 130 }, (_, i) => 2001 + i);
const FCS_TEAM = 9001;
/** CFBD sometimes omits `classification`; a null must not read as "not FBS". */
const UNCLASSIFIED_TEAM = 9002;

/**
 * Slot per overall pick for 11 managers over 10 rounds, built from the plain
 * definition of a snake (forward on odd rounds, back on even) rather than from
 * `slotForPick` — otherwise these tests would only prove the route calls that
 * function, not that the function is right.
 */
const expectedSlots: number[] = Array.from({ length: 10 }, (_unused, round) => {
  const forward = Array.from({ length: 11 }, (_slot, index) => index + 1);
  return round % 2 === 0 ? forward : forward.reverse();
}).flat();

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  // Hono's fetch is typed as Response | Promise<Response>; await normalizes it.
  return app.fetch(new Request(`https://mbl.test${path}`, init), testEnv);
}

function write(
  method: 'POST' | 'PUT',
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<Response> {
  return send(path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Sessions are minted directly: these tests are about the draft, not about login. */
async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(getDb(testEnv), userId);
  return `mbl_session=${token}`;
}

async function addTeams(): Promise<void> {
  const db = getDb(testEnv);
  const rows = [
    ...FBS_TEAMS.map((id) => ({ id, school: `School ${id}`, classification: 'fbs' })),
    { id: FCS_TEAM, school: 'Directional State', classification: 'fcs' },
    { id: UNCLASSIFIED_TEAM, school: 'Unlabelled Tech', classification: null },
  ];
  await insertChunked(rows, 3, (chunk) => db.insert(teams).values(chunk));
}

async function setOrder(userIds: string[] = ids): Promise<void> {
  const db = getDb(testEnv);
  await db.delete(draftOrder).where(eq(draftOrder.seasonYear, SEASON));
  await insertChunked(
    userIds.map((userId, index) => ({ seasonYear: SEASON, slot: index + 1, userId })),
    3,
    (chunk) => db.insert(draftOrder).values(chunk),
  );
}

async function setStatus(draftStatus: 'pending' | 'active' | 'complete'): Promise<void> {
  await getDb(testEnv).update(seasons).set({ draftStatus }).where(eq(seasons.year, SEASON));
}

async function getState(): Promise<DraftState> {
  const response = await send('/api/draft');
  expect(response.status).toBe(200);
  return (await response.json()) as DraftState;
}

describe('draft', () => {
  let commissionerCookie: string;

  beforeEach(async () => {
    await migrate();
    await seedManagers(
      MANAGERS.map((username) => ({
        username,
        password: `${username}-pass`,
        isCommissioner: username === 'tom',
      })),
    );
    await addTeams();
    commissionerCookie = await cookieFor(COMMISSIONER);
  });

  describe('GET /api/draft', () => {
    it('is public and reports a fresh season as pending with nothing derivable', async () => {
      const state = await getState();

      expect(state).toMatchObject({
        season: SEASON,
        draftStatus: 'pending',
        rounds: 10,
        managerCount: 0,
        order: [],
        picks: [],
        nextPickNumber: null,
        currentRound: null,
        onClockUser: null,
        onClockSince: null,
      });
    });

    it('puts slot 1 on the clock once the order exists', async () => {
      await setOrder();

      const state = await getState();

      expect(state.managerCount).toBe(11);
      expect(state.order.map((manager) => manager.id)).toEqual(ids);
      expect(state.order[0]).toEqual({ id: COMMISSIONER, displayName: 'tom', avatarHue: 200 });
      expect(state.nextPickNumber).toBe(1);
      expect(state.currentRound).toBe(1);
      expect(state.onClockUser?.id).toBe(COMMISSIONER);
      // Nobody has gone up yet, so there is no "on the clock since".
      expect(state.onClockSince).toBeNull();
    });

    it('returns picks in order with the round, team and manager resolved', async () => {
      await setOrder();
      await setStatus('active');
      await write('POST', '/api/draft/pick', { teamId: FBS_TEAMS[0] }, commissionerCookie);

      const state = await getState();

      expect(state.picks).toHaveLength(1);
      expect(state.picks[0]).toMatchObject({
        pickNumber: 1,
        round: 1,
        team: { id: FBS_TEAMS[0], school: `School ${FBS_TEAMS[0]}` },
        user: { id: COMMISSIONER, displayName: 'tom' },
        madeByCommissioner: false,
      });
      expect(state.picks[0]!.createdAt).toBeGreaterThan(0);
      // The clock moved to slot 2, starting when pick 1 landed.
      expect(state.onClockUser?.id).toBe(ids[1]);
      expect(state.onClockSince).toBe(state.picks[0]!.createdAt);
    });
  });

  describe('POST /api/draft/pick', () => {
    beforeEach(async () => {
      await setOrder();
      await setStatus('active');
    });

    it('records the pick for the manager on the clock', async () => {
      const response = await write(
        'POST',
        '/api/draft/pick',
        { teamId: FBS_TEAMS[0] },
        commissionerCookie,
      );

      expect(response.status).toBe(200);
      const state = (await response.json()) as DraftState;
      expect(state.picks).toHaveLength(1);
      expect(state.nextPickNumber).toBe(2);
      expect(state.onClockUser?.id).toBe(ids[1]);

      const stored = await getDb(testEnv).select().from(picks).all();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        seasonYear: SEASON,
        pickNumber: 1,
        userId: COMMISSIONER,
        madeByUserId: COMMISSIONER,
        teamId: FBS_TEAMS[0],
      });
    });

    it('accepts a team CFBD left unclassified', async () => {
      const response = await write(
        'POST',
        '/api/draft/pick',
        { teamId: UNCLASSIFIED_TEAM },
        commissionerCookie,
      );
      expect(response.status).toBe(200);
    });

    it('rejects a guest with 401', async () => {
      const response = await write('POST', '/api/draft/pick', { teamId: FBS_TEAMS[0] });
      expect(response.status).toBe(401);
      expect(await getDb(testEnv).select().from(picks).all()).toHaveLength(0);
    });

    it('rejects a manager who is not on the clock with 403', async () => {
      const response = await write(
        'POST',
        '/api/draft/pick',
        { teamId: FBS_TEAMS[0] },
        await cookieFor(ids[1]!),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'It is not your turn to pick.' });
      expect(await getDb(testEnv).select().from(picks).all()).toHaveLength(0);
    });

    it('rejects a manager left out of the draft order with 403', async () => {
      await setOrder(ids.slice(0, 10));

      const response = await write(
        'POST',
        '/api/draft/pick',
        { teamId: FBS_TEAMS[0] },
        await cookieFor(ids[10]!),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'You are not in the draft order.' });
    });

    it('refuses a team another manager already owns, naming them', async () => {
      await write('POST', '/api/draft/pick', { teamId: FBS_TEAMS[0] }, commissionerCookie);

      const response = await write(
        'POST',
        '/api/draft/pick',
        { teamId: FBS_TEAMS[0] },
        await cookieFor(ids[1]!),
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'tom already drafted that team.' });
      expect(await getDb(testEnv).select().from(picks).all()).toHaveLength(1);
    });

    it('refuses a team the same manager already owns', async () => {
      // tom holds slot 1, so with 11 managers he is up again at pick 22 — the
      // cheapest way to have one manager attempt two picks.
      for (let pick = 1; pick <= 21; pick += 1) {
        const userId = ids[expectedSlots[pick - 1]! - 1]!;
        const response = await write(
          'POST',
          '/api/draft/pick',
          { teamId: FBS_TEAMS[pick - 1] },
          await cookieFor(userId),
        );
        expect(response.status).toBe(200);
      }
      expect((await getState()).onClockUser?.id).toBe(COMMISSIONER);

      const response = await write(
        'POST',
        '/api/draft/pick',
        { teamId: FBS_TEAMS[0] },
        commissionerCookie,
      );
      expect(response.status).toBe(409);
    }, 20_000);

    it('refuses a non-FBS team and an unknown team with 400', async () => {
      const fcs = await write('POST', '/api/draft/pick', { teamId: FCS_TEAM }, commissionerCookie);
      expect(fcs.status).toBe(400);
      expect(await fcs.json()).toEqual({ error: 'That team is not in the draft pool.' });

      const unknown = await write('POST', '/api/draft/pick', { teamId: 4242 }, commissionerCookie);
      expect(unknown.status).toBe(400);
    });

    it('rejects a malformed body with 400, not 500', async () => {
      for (const body of [undefined, {}, { teamId: 'nebraska' }, { teamId: -1 }, { teamId: 1.5 }]) {
        const response = await write('POST', '/api/draft/pick', body, commissionerCookie);
        expect(response.status).toBe(400);
      }
    });

    it('refuses picks while the draft is pending', async () => {
      await setStatus('pending');

      const response = await write(
        'POST',
        '/api/draft/pick',
        { teamId: FBS_TEAMS[0] },
        commissionerCookie,
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'The draft has not been opened yet.' });
    });

    it('refuses picks once the draft is closed', async () => {
      await setStatus('complete');

      const response = await write(
        'POST',
        '/api/draft/pick',
        { teamId: FBS_TEAMS[0] },
        commissionerCookie,
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'The draft is closed.' });
    });

    it('refuses picks when no order has been set', async () => {
      await getDb(testEnv).delete(draftOrder);

      const response = await write(
        'POST',
        '/api/draft/pick',
        { teamId: FBS_TEAMS[0] },
        commissionerCookie,
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'The draft order has not been set yet.' });
    });
  });

  describe('a full 11 by 10 snake draft', () => {
    beforeEach(async () => {
      await setOrder();
      await setStatus('active');
    });

    it('lands every pick in the right slot and closes itself', async () => {
      const cookies = new Map<string, string>();
      for (const id of ids) cookies.set(id, await cookieFor(id));

      for (const [index, slot] of expectedSlots.entries()) {
        const userId = ids[slot - 1]!;
        const response = await write(
          'POST',
          '/api/draft/pick',
          { teamId: FBS_TEAMS[index] },
          cookies.get(userId),
        );
        // A wrong turn would 403 here rather than at the assertions below.
        expect([index + 1, response.status]).toEqual([index + 1, 200]);
      }

      const state = await getState();
      expect(state.picks).toHaveLength(110);
      expect(state.picks.map((pick) => pick.user.id)).toEqual(
        expectedSlots.map((slot) => ids[slot - 1]),
      );
      expect(state.picks.map((pick) => pick.round)).toEqual(
        expectedSlots.map((_slot, index) => Math.floor(index / 11) + 1),
      );

      // Every manager ends with exactly ten teams, and nobody owns two of the same.
      const perManager = new Map<string, number>();
      for (const pick of state.picks) {
        perManager.set(pick.user.id, (perManager.get(pick.user.id) ?? 0) + 1);
      }
      expect([...perManager.values()]).toEqual(Array.from({ length: 11 }, () => 10));
      expect(new Set(state.picks.map((pick) => pick.team.id)).size).toBe(110);

      // The draft closes on the last pick instead of waiting for the commissioner.
      expect(state.draftStatus).toBe('complete');
      expect(state.nextPickNumber).toBeNull();
      expect(state.currentRound).toBeNull();
      expect(state.onClockUser).toBeNull();
      expect(state.onClockSince).toBeNull();

      const extra = await write(
        'POST',
        '/api/draft/pick',
        { teamId: FBS_TEAMS[120] },
        commissionerCookie,
      );
      expect(extra.status).toBe(409);
    }, 60_000);

    it('snakes back at the turn: slot 11 picks twice in a row', async () => {
      // Independent of slotForPick: picks 11 and 12 are both slot 11 by
      // definition of a snake, and 13 comes back down to slot 10.
      expect(expectedSlots[10]).toBe(11);
      expect(expectedSlots[11]).toBe(11);
      expect(expectedSlots[12]).toBe(10);
    });
  });

  describe('POST /api/draft/pick-for', () => {
    beforeEach(async () => {
      await setOrder();
      await setStatus('active');
    });

    it('records the manager as owner and the commissioner as the one who picked', async () => {
      // Get past slot 1 (the commissioner's own) so this is genuinely on someone
      // else's behalf.
      await write('POST', '/api/draft/pick', { teamId: FBS_TEAMS[0] }, commissionerCookie);

      const response = await write(
        'POST',
        '/api/draft/pick-for',
        { userId: ids[1], teamId: FBS_TEAMS[1] },
        commissionerCookie,
      );

      expect(response.status).toBe(200);
      const state = (await response.json()) as DraftState;
      expect(state.picks[1]).toMatchObject({
        pickNumber: 2,
        user: { id: ids[1] },
        madeByCommissioner: true,
      });

      const stored = await getDb(testEnv)
        .select()
        .from(picks)
        .where(eq(picks.pickNumber, 2))
        .get();
      expect(stored).toMatchObject({ userId: ids[1], madeByUserId: COMMISSIONER });
    });

    it('is not flagged as a commissioner pick when the commissioner picks for themselves', async () => {
      const response = await write(
        'POST',
        '/api/draft/pick-for',
        { userId: COMMISSIONER, teamId: FBS_TEAMS[0] },
        commissionerCookie,
      );

      expect(response.status).toBe(200);
      const state = (await response.json()) as DraftState;
      expect(state.picks[0]!.madeByCommissioner).toBe(false);
    });

    it('still respects turn order — the commissioner cannot pick out of turn', async () => {
      const response = await write(
        'POST',
        '/api/draft/pick-for',
        { userId: ids[5], teamId: FBS_TEAMS[0] },
        commissionerCookie,
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'That manager is not on the clock.' });
      expect(await getDb(testEnv).select().from(picks).all()).toHaveLength(0);
    });

    it('rejects a manager who is not in the draft order', async () => {
      const response = await write(
        'POST',
        '/api/draft/pick-for',
        { userId: 'usr_nobody', teamId: FBS_TEAMS[0] },
        commissionerCookie,
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'That manager is not in the draft order.' });
    });

    it('applies the same team rules', async () => {
      const fcs = await write(
        'POST',
        '/api/draft/pick-for',
        { userId: COMMISSIONER, teamId: FCS_TEAM },
        commissionerCookie,
      );
      expect(fcs.status).toBe(400);

      await write('POST', '/api/draft/pick', { teamId: FBS_TEAMS[0] }, commissionerCookie);
      const taken = await write(
        'POST',
        '/api/draft/pick-for',
        { userId: ids[1], teamId: FBS_TEAMS[0] },
        commissionerCookie,
      );
      expect(taken.status).toBe(409);
    });

    it('rejects a guest with 401 and a non-commissioner with 403', async () => {
      const guest = await write('POST', '/api/draft/pick-for', {
        userId: COMMISSIONER,
        teamId: FBS_TEAMS[0],
      });
      expect(guest.status).toBe(401);

      const manager = await write(
        'POST',
        '/api/draft/pick-for',
        { userId: COMMISSIONER, teamId: FBS_TEAMS[0] },
        await cookieFor(ids[1]!),
      );
      expect(manager.status).toBe(403);
      expect(await manager.json()).toEqual({ error: 'Commissioner only' });
    });

    it('rejects a malformed body with 400, not 500', async () => {
      for (const body of [undefined, {}, { teamId: FBS_TEAMS[0] }, { userId: COMMISSIONER }]) {
        const response = await write('POST', '/api/draft/pick-for', body, commissionerCookie);
        expect(response.status).toBe(400);
      }
    });
  });

  describe('POST /api/draft/status', () => {
    it('opens the draft once an order exists', async () => {
      await setOrder();

      const response = await write(
        'POST',
        '/api/draft/status',
        { draftStatus: 'active' },
        commissionerCookie,
      );

      expect(response.status).toBe(200);
      expect(((await response.json()) as DraftState).draftStatus).toBe('active');
      expect((await getState()).draftStatus).toBe('active');
    });

    it('refuses to open a draft with no order', async () => {
      const response = await write(
        'POST',
        '/api/draft/status',
        { draftStatus: 'active' },
        commissionerCookie,
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: 'Set the draft order before opening the draft.',
      });
      expect((await getState()).draftStatus).toBe('pending');
    });

    it('can close and reopen the draft', async () => {
      await setOrder();
      await write('POST', '/api/draft/status', { draftStatus: 'complete' }, commissionerCookie);
      expect((await getState()).draftStatus).toBe('complete');

      await write('POST', '/api/draft/status', { draftStatus: 'active' }, commissionerCookie);
      expect((await getState()).draftStatus).toBe('active');
    });

    it('rejects a guest with 401 and a non-commissioner with 403', async () => {
      expect((await write('POST', '/api/draft/status', { draftStatus: 'active' })).status).toBe(401);
      expect(
        (
          await write(
            'POST',
            '/api/draft/status',
            { draftStatus: 'active' },
            await cookieFor(ids[1]!),
          )
        ).status,
      ).toBe(403);
    });

    it('rejects a malformed body with 400, not 500', async () => {
      for (const body of [undefined, {}, { draftStatus: 'paused' }, { draftStatus: 1 }]) {
        const response = await write('POST', '/api/draft/status', body, commissionerCookie);
        expect(response.status).toBe(400);
      }
    });

    it('404s when the season row does not exist', async () => {
      await getDb(testEnv).delete(draftOrder);
      await getDb(testEnv).delete(seasons);

      const response = await write(
        'POST',
        '/api/draft/status',
        { draftStatus: 'active' },
        commissionerCookie,
      );
      expect(response.status).toBe(404);
    });
  });

  describe('PUT /api/draft/order', () => {
    it('sets the order, index 0 being slot 1', async () => {
      const shuffled = [...ids].reverse();

      const response = await write('PUT', '/api/draft/order', { userIds: shuffled }, commissionerCookie);

      expect(response.status).toBe(200);
      const state = (await response.json()) as DraftState;
      expect(state.order.map((manager) => manager.id)).toEqual(shuffled);
      expect(state.onClockUser?.id).toBe(shuffled[0]);

      const stored = await getDb(testEnv)
        .select()
        .from(draftOrder)
        .orderBy(draftOrder.slot)
        .all();
      expect(stored.map((row) => [row.slot, row.userId])).toEqual(
        shuffled.map((userId, index) => [index + 1, userId]),
      );
    });

    it('replaces the whole order rather than merging into it', async () => {
      await write('PUT', '/api/draft/order', { userIds: ids }, commissionerCookie);
      const shorter = ids.slice(0, 4);

      await write('PUT', '/api/draft/order', { userIds: shorter }, commissionerCookie);

      const state = await getState();
      expect(state.managerCount).toBe(4);
      expect(state.order.map((manager) => manager.id)).toEqual(shorter);
    });

    it('locks the order once a pick has been made', async () => {
      await setOrder();
      await setStatus('active');
      await write('POST', '/api/draft/pick', { teamId: FBS_TEAMS[0] }, commissionerCookie);

      const response = await write(
        'PUT',
        '/api/draft/order',
        { userIds: [...ids].reverse() },
        commissionerCookie,
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: 'Picks have already been made — the draft order is locked.',
      });
      // The stored order is untouched, so the pick already made still belongs to
      // the slot it was made from.
      expect((await getState()).order.map((manager) => manager.id)).toEqual(ids);
    });

    it('rejects an id that is not a manager', async () => {
      const response = await write(
        'PUT',
        '/api/draft/order',
        { userIds: [...ids.slice(0, 3), 'usr_ghost'] },
        commissionerCookie,
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'That is not a league manager.' });
      expect((await getState()).managerCount).toBe(0);
    });

    it('rejects a malformed body with 400, not 500', async () => {
      const bodies = [
        undefined,
        {},
        { userIds: [] },
        { userIds: [ids[0]] },
        // A manager cannot hold two slots.
        { userIds: [ids[0], ids[1], ids[0]] },
        { userIds: [1, 2] },
      ];
      for (const body of bodies) {
        const response = await write('PUT', '/api/draft/order', body, commissionerCookie);
        expect(response.status).toBe(400);
      }
    });

    it('rejects a guest with 401 and a non-commissioner with 403', async () => {
      expect((await write('PUT', '/api/draft/order', { userIds: ids })).status).toBe(401);
      expect(
        (await write('PUT', '/api/draft/order', { userIds: ids }, await cookieFor(ids[1]!))).status,
      ).toBe(403);
    });
  });

  /**
   * A genuine race can't be staged over HTTP here, so these go at the indexes
   * directly and check that the error they raise is the one the route maps to a
   * 409. Without this the fallback would look correct and quietly 500.
   */
  describe('database guarantees', () => {
    const base = { seasonYear: SEASON, createdAt: new Date() };

    async function firstPick(): Promise<void> {
      await getDb(testEnv).insert(picks).values({
        ...base,
        id: 'p1',
        pickNumber: 1,
        teamId: FBS_TEAMS[0]!,
        userId: COMMISSIONER,
        madeByUserId: COMMISSIONER,
      });
    }

    it('refuses two picks of the same team, and the route reads that as a conflict', async () => {
      await firstPick();

      const error = await getDb(testEnv)
        .insert(picks)
        .values({
          ...base,
          id: 'p2',
          pickNumber: 2,
          teamId: FBS_TEAMS[0]!,
          userId: ids[1]!,
          madeByUserId: ids[1]!,
        })
        .then(() => null)
        .catch((thrown: unknown) => thrown);

      expect(error).not.toBeNull();
      expect(uniqueViolation(error)).toBe('team');
    });

    it('refuses two picks at the same pick number', async () => {
      await firstPick();

      const error = await getDb(testEnv)
        .insert(picks)
        .values({
          ...base,
          id: 'p2',
          pickNumber: 1,
          teamId: FBS_TEAMS[1]!,
          userId: ids[1]!,
          madeByUserId: ids[1]!,
        })
        .then(() => null)
        .catch((thrown: unknown) => thrown);

      expect(uniqueViolation(error)).toBe('other');
    });

    it('does not mistake an unrelated failure for a conflict', async () => {
      const error = await getDb(testEnv)
        .insert(picks)
        .values({ ...base, id: 'p1', pickNumber: 1, teamId: 123456, userId: COMMISSIONER, madeByUserId: COMMISSIONER })
        .then(() => null)
        .catch((thrown: unknown) => thrown);

      // A team that isn't in the pool trips the foreign key, not a unique index,
      // and must surface as a 500 rather than a misleading 409.
      expect(error).not.toBeNull();
      expect(uniqueViolation(error)).toBeNull();
    });
  });
});

