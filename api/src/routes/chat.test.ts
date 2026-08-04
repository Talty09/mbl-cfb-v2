import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChatMessageView, ChatResponse } from 'shared';
import { chatMessages, seasons, sessions } from '../db/schema';
import { getDb, insertChunked } from '../lib/db';
import { attachSession } from '../middleware/auth';
import { migrate, seedManagers, sessionCookieFrom, SEASON, testEnv } from '../test/helpers';
import type { AppEnv } from '../types';
import { authRoutes } from './auth';
import { chatRoutes } from './chat';

const PASSPHRASE = 'bench-helm-dusk-lantern-ermine-kettle';
const OTHER_PASSPHRASE = 'elder-hoop-meteor-muzzle-cotton-brass';

/**
 * Assembled the same way as `app.ts` — session middleware, then the routes — but
 * built here rather than imported, because chat is wired into the real app
 * separately. Login is mounted alongside so the tests authenticate the way a
 * browser does, through a Set-Cookie from a real sign-in.
 */
const app = new Hono<AppEnv>().basePath('/api');
app.use('*', attachSession);
app.route('/', authRoutes);
app.route('/', chatRoutes);

async function request(path: string, init?: RequestInit): Promise<Response> {
  return app.fetch(new Request(`https://mbl.test${path}`, init), testEnv);
}

function post(path: string, body?: unknown, cookie?: string): Promise<Response> {
  return request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function get(path: string, cookie?: string): Promise<Response> {
  return request(path, { headers: cookie ? { cookie } : {} });
}

async function readChat(path = '/api/chat', cookie?: string): Promise<ChatResponse> {
  const response = await get(path, cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as ChatResponse;
}

/** Sign in and return the session cookie, as a browser would hold it. */
async function login(username: string, password: string): Promise<string> {
  const response = await post('/api/auth/login', { username, password });
  expect(response.status).toBe(200);
  return sessionCookieFrom(response)!;
}

/**
 * Insert messages straight into the table. Bodies are "m1".."mN" so ordering
 * assertions read as the sequence they were written in. Chunked because D1 caps
 * bound parameters per statement.
 */
async function seedMessages(
  count: number,
  options: { userId?: string; season?: number; prefix?: string } = {},
): Promise<void> {
  const { userId = 'usr_tom', season = SEASON, prefix = 'm' } = options;
  const base = Date.UTC(2026, 8, 1);
  const rows = Array.from({ length: count }, (_, i) => ({
    seasonYear: season,
    userId,
    body: `${prefix}${i + 1}`,
    createdAt: new Date(base + i * 1_000),
  }));

  await insertChunked(rows, 4, (chunk) => getDb(testEnv).insert(chatMessages).values(chunk));
}

function bodies(response: ChatResponse): string[] {
  return response.messages.map((message) => message.body);
}

describe('chat', () => {
  beforeEach(async () => {
    await migrate();
    await seedManagers([
      { username: 'tom', password: PASSPHRASE, isCommissioner: true },
      { username: 'zac', password: OTHER_PASSPHRASE },
    ]);
  });

  describe('GET /api/chat', () => {
    it('lets a guest read without signing in', async () => {
      await seedMessages(3);

      const chat = await readChat();
      expect(bodies(chat)).toEqual(['m1', 'm2', 'm3']);
    });

    it('returns an empty array when nobody has said anything yet', async () => {
      const chat = await readChat();
      expect(chat.messages).toEqual([]);
    });

    it('embeds each author so the client never needs a second lookup', async () => {
      await seedMessages(1, { userId: 'usr_zac' });

      const chat = await readChat();
      expect(chat.messages[0]!.user).toEqual({
        id: 'usr_zac',
        displayName: 'zac',
        avatarHue: 200,
      });
    });

    it('returns createdAt as epoch ms, not a date string', async () => {
      await seedMessages(1);

      const chat = await readChat();
      expect(chat.messages[0]!.createdAt).toBe(Date.UTC(2026, 8, 1));
    });

    it('returns messages oldest-first so the client can append', async () => {
      await seedMessages(5);

      const chat = await readChat();
      expect(bodies(chat)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
      const ids = chat.messages.map((message) => message.id);
      expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    });

    it('ignores messages from another season', async () => {
      await getDb(testEnv)
        .insert(seasons)
        .values({ year: SEASON - 1, draftStatus: 'complete', rounds: 10, isCurrent: false });
      await seedMessages(2, { season: SEASON - 1, prefix: 'old' });
      await seedMessages(2);

      const chat = await readChat();
      expect(bodies(chat)).toEqual(['m1', 'm2']);
    });

    describe('?since=', () => {
      it('returns only messages newer than the cursor, excluding it', async () => {
        await seedMessages(4);
        const all = await readChat();
        const second = all.messages[1]!;

        const newer = await readChat(`/api/chat?since=${second.id}`);
        expect(bodies(newer)).toEqual(['m3', 'm4']);
        expect(newer.messages.map((message) => message.id)).not.toContain(second.id);
      });

      it('returns an empty array, not an error, when the cursor is the newest id', async () => {
        await seedMessages(3);
        const all = await readChat();
        const newest = all.messages.at(-1)!;

        const response = await get(`/api/chat?since=${newest.id}`);
        expect(response.status).toBe(200);
        expect(((await response.json()) as ChatResponse).messages).toEqual([]);
      });

      it('returns an empty array for a cursor far beyond the newest id', async () => {
        await seedMessages(3);

        const chat = await readChat('/api/chat?since=999999');
        expect(chat.messages).toEqual([]);
      });

      it('treats since=0 as "everything"', async () => {
        await seedMessages(3);

        const chat = await readChat('/api/chat?since=0');
        expect(bodies(chat)).toEqual(['m1', 'm2', 'm3']);
      });

      it('stays chronological and applies the limit to the oldest unseen messages', async () => {
        await seedMessages(6);

        const chat = await readChat('/api/chat?since=0&limit=3');
        expect(bodies(chat)).toEqual(['m1', 'm2', 'm3']);
      });
    });

    describe('?limit=', () => {
      it('respects an explicit limit', async () => {
        await seedMessages(10);

        const chat = await readChat('/api/chat?limit=4');
        expect(chat.messages).toHaveLength(4);
      });

      it('returns the newest page, in chronological order, when there is more than a page', async () => {
        // More messages than the default page, so an ascending query with a
        // LIMIT would hand back m1..m100 — the wrong end of the table.
        await seedMessages(120);

        const chat = await readChat();
        expect(chat.messages).toHaveLength(100);
        expect(bodies(chat).at(0)).toBe('m21');
        expect(bodies(chat).at(-1)).toBe('m120');
      });

      it('returns the newest page under an explicit limit too', async () => {
        await seedMessages(10);

        const chat = await readChat('/api/chat?limit=3');
        expect(bodies(chat)).toEqual(['m8', 'm9', 'm10']);
      });

      it('caps the limit at 200', async () => {
        await seedMessages(210);

        const chat = await readChat('/api/chat?limit=1000');
        expect(chat.messages).toHaveLength(200);
        expect(bodies(chat).at(-1)).toBe('m210');
      });
    });

    describe('malformed query params', () => {
      it('rejects a non-numeric cursor or limit with 400, not 500', async () => {
        expect((await get('/api/chat?since=abc')).status).toBe(400);
        expect((await get('/api/chat?limit=abc')).status).toBe(400);
        expect((await get('/api/chat?since=')).status).toBe(400);
        expect((await get('/api/chat?since=1.5')).status).toBe(400);
      });

      it('rejects a negative cursor or limit', async () => {
        expect((await get('/api/chat?since=-1')).status).toBe(400);
        expect((await get('/api/chat?limit=-5')).status).toBe(400);
      });

      it('rejects limit=0, which could only ever return nothing', async () => {
        expect((await get('/api/chat?limit=0')).status).toBe(400);
      });

      it('answers with an error body, not an empty 400', async () => {
        const response = await get('/api/chat?limit=nope');
        expect(await response.json()).toMatchObject({ error: expect.any(String) });
      });
    });

    describe('onlineCount', () => {
      it('counts managers seen within the online window', async () => {
        await login('tom', PASSPHRASE);
        await login('zac', OTHER_PASSPHRASE);

        expect((await readChat()).onlineCount).toBe(2);
      });

      it('is zero when nobody has a session', async () => {
        expect((await readChat()).onlineCount).toBe(0);
      });

      it('counts a manager once however many sessions they hold', async () => {
        await login('tom', PASSPHRASE);
        await login('tom', PASSPHRASE);

        expect((await readChat()).onlineCount).toBe(1);
      });

      it('ignores sessions that have gone stale', async () => {
        const cookie = await login('tom', PASSPHRASE);
        await login('zac', OTHER_PASSPHRASE);

        // Age tom's session past the window. Read as a guest afterwards: sending
        // tom's cookie would slide `lastSeenAt` back to now and hide the bug.
        await getDb(testEnv)
          .update(sessions)
          .set({ lastSeenAt: new Date(Date.now() - 10 * 60 * 1_000) })
          .where(eq(sessions.userId, 'usr_tom'));
        expect(cookie).toContain('mbl_session=');

        expect((await readChat()).onlineCount).toBe(1);
      });
    });
  });

  describe('POST /api/chat', () => {
    it('rejects a guest with 401 and writes nothing', async () => {
      const response = await post('/api/chat', { body: 'let me in' });
      expect(response.status).toBe(401);

      const rows = await getDb(testEnv).select().from(chatMessages).all();
      expect(rows).toHaveLength(0);
    });

    it('posts under the signed-in manager and returns the message', async () => {
      const cookie = await login('zac', OTHER_PASSPHRASE);

      const response = await post('/api/chat', { body: 'your team is cooked' }, cookie);
      expect(response.status).toBe(201);

      const message = (await response.json()) as ChatMessageView;
      expect(message).toMatchObject({
        body: 'your team is cooked',
        user: { id: 'usr_zac', displayName: 'zac', avatarHue: 200 },
      });
      expect(message.id).toBeGreaterThan(0);
      expect(message.createdAt).toBeCloseTo(Date.now(), -4);
    });

    it('stores the message against the current season', async () => {
      const cookie = await login('tom', PASSPHRASE);
      await post('/api/chat', { body: 'first' }, cookie);

      const rows = await getDb(testEnv).select().from(chatMessages).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ seasonYear: SEASON, userId: 'usr_tom', body: 'first' });
    });

    it('shows up in a subsequent read, after any earlier messages', async () => {
      await seedMessages(2);
      const cookie = await login('tom', PASSPHRASE);

      await post('/api/chat', { body: 'm3' }, cookie);

      expect(bodies(await readChat())).toEqual(['m1', 'm2', 'm3']);
    });

    it('is reachable by a since= poll using the returned id as the cursor', async () => {
      const cookie = await login('tom', PASSPHRASE);
      const created = await post('/api/chat', { body: 'one' }, cookie);
      const first = (await created.json()) as ChatMessageView;
      await post('/api/chat', { body: 'two' }, cookie);

      const chat = await readChat(`/api/chat?since=${first.id}`);
      expect(bodies(chat)).toEqual(['two']);
    });

    it('trims surrounding whitespace', async () => {
      const cookie = await login('tom', PASSPHRASE);

      const response = await post('/api/chat', { body: '  spaced out\n' }, cookie);
      expect(((await response.json()) as ChatMessageView).body).toBe('spaced out');

      const rows = await getDb(testEnv).select().from(chatMessages).all();
      expect(rows[0]!.body).toBe('spaced out');
    });

    it('rejects an empty or whitespace-only body with 400', async () => {
      const cookie = await login('tom', PASSPHRASE);

      expect((await post('/api/chat', { body: '' }, cookie)).status).toBe(400);
      expect((await post('/api/chat', { body: '   ' }, cookie)).status).toBe(400);
      expect((await post('/api/chat', { body: '\n\t ' }, cookie)).status).toBe(400);
      expect(await getDb(testEnv).select().from(chatMessages).all()).toHaveLength(0);
    });

    it('rejects a missing, wrongly typed, or absent body with 400, not 500', async () => {
      const cookie = await login('tom', PASSPHRASE);

      expect((await post('/api/chat', {}, cookie)).status).toBe(400);
      expect((await post('/api/chat', { body: 42 }, cookie)).status).toBe(400);
      expect((await post('/api/chat', undefined, cookie)).status).toBe(400);
    });

    it('accepts 2000 characters and rejects 2001', async () => {
      const cookie = await login('tom', PASSPHRASE);

      expect((await post('/api/chat', { body: 'x'.repeat(2000) }, cookie)).status).toBe(201);
      expect((await post('/api/chat', { body: 'x'.repeat(2001) }, cookie)).status).toBe(400);
      expect(await getDb(testEnv).select().from(chatMessages).all()).toHaveLength(1);
    });

    it('checks the session before the body, so a guest cannot probe validation', async () => {
      expect((await post('/api/chat', { body: '' })).status).toBe(401);
    });

    it('hands out monotonically increasing ids for use as a cursor', async () => {
      const cookie = await login('tom', PASSPHRASE);

      const ids: number[] = [];
      for (const body of ['a', 'b', 'c']) {
        const response = await post('/api/chat', { body }, cookie);
        ids.push(((await response.json()) as ChatMessageView).id);
      }

      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      expect(new Set(ids).size).toBe(3);
    });
  });
});
