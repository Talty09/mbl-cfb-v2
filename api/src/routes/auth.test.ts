import { beforeEach, describe, expect, it } from 'vitest';
import { api } from '../app';
import { getDb } from '../lib/db';
import { sessions } from '../db/schema';
import { migrate, seedManagers, sessionCookieFrom, testEnv } from '../test/helpers';

const PASSPHRASE = 'bench-helm-dusk-lantern-ermine-kettle';

async function request(path: string, init?: RequestInit): Promise<Response> {
  return api.fetch(new Request(`https://mbl.test${path}`, init), testEnv);
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

describe('auth', () => {
  beforeEach(async () => {
    await migrate();
    await seedManagers([
      { username: 'tom', password: PASSPHRASE, isCommissioner: true },
      { username: 'zac', password: 'elder-hoop-meteor-muzzle-cotton-brass' },
    ]);
  });

  describe('POST /api/auth/login', () => {
    it('signs in with the right passphrase and sets an httpOnly cookie', async () => {
      const response = await post('/api/auth/login', {
        username: 'tom',
        password: PASSPHRASE,
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        user: { username: 'tom', isCommissioner: true },
      });

      const setCookie = response.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain('mbl_session=');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
    });

    it('never returns the password hash', async () => {
      const response = await post('/api/auth/login', {
        username: 'tom',
        password: PASSPHRASE,
      });
      expect(JSON.stringify(await response.json())).not.toContain('pbkdf2');
    });

    it('is case-insensitive on the username', async () => {
      const response = await post('/api/auth/login', {
        username: '  TOM  ',
        password: PASSPHRASE,
      });
      expect(response.status).toBe(200);
    });

    it('rejects a wrong passphrase', async () => {
      const response = await post('/api/auth/login', { username: 'tom', password: 'nope' });
      expect(response.status).toBe(401);
      expect(response.headers.get('set-cookie')).toBeNull();
    });

    it('rejects an unknown username with the same message as a wrong passphrase', async () => {
      const unknown = await post('/api/auth/login', { username: 'nobody', password: PASSPHRASE });
      const wrong = await post('/api/auth/login', { username: 'tom', password: 'nope' });
      expect(unknown.status).toBe(401);
      expect(await unknown.json()).toEqual(await wrong.json());
    });

    it('rejects a malformed body with 400, not 500', async () => {
      expect((await post('/api/auth/login', { username: 'tom' })).status).toBe(400);
      expect((await post('/api/auth/login', {})).status).toBe(400);
      expect((await post('/api/auth/login')).status).toBe(400);
    });

    it('refuses a manager with no password set', async () => {
      const db = getDb(testEnv);
      const { users } = await import('../db/schema');
      const { eq } = await import('drizzle-orm');
      await db.update(users).set({ passwordHash: null }).where(eq(users.username, 'zac'));

      const response = await post('/api/auth/login', { username: 'zac', password: 'anything' });
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns the manager when the session cookie is sent', async () => {
      const login = await post('/api/auth/login', { username: 'tom', password: PASSPHRASE });
      const cookie = sessionCookieFrom(login)!;

      const response = await request('/api/auth/me', { headers: { cookie } });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ user: { username: 'tom' } });
    });

    it('returns user: null for a guest rather than 401', async () => {
      const response = await request('/api/auth/me');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ user: null });
    });

    it('treats a forged cookie as a guest and clears it', async () => {
      const response = await request('/api/auth/me', {
        headers: { cookie: 'mbl_session=not-a-real-token' },
      });
      expect(await response.json()).toEqual({ user: null });
      expect(response.headers.get('set-cookie') ?? '').toContain('mbl_session=;');
    });

    it('rejects a session whose row has expired', async () => {
      const login = await post('/api/auth/login', { username: 'tom', password: PASSPHRASE });
      const cookie = sessionCookieFrom(login)!;

      const db = getDb(testEnv);
      await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1_000) });

      const response = await request('/api/auth/me', { headers: { cookie } });
      expect(await response.json()).toEqual({ user: null });
    });
  });

  describe('POST /api/auth/logout', () => {
    it('revokes the session so the cookie stops working', async () => {
      const login = await post('/api/auth/login', { username: 'tom', password: PASSPHRASE });
      const cookie = sessionCookieFrom(login)!;

      const loggedOut = await post('/api/auth/logout', undefined, cookie);
      expect(loggedOut.status).toBe(200);

      const after = await request('/api/auth/me', { headers: { cookie } });
      expect(await after.json()).toEqual({ user: null });

      // Revoked, not merely forgotten by the browser.
      const db = getDb(testEnv);
      expect(await db.select().from(sessions).all()).toHaveLength(0);
    });

    it('succeeds when already signed out', async () => {
      expect((await post('/api/auth/logout')).status).toBe(200);
    });
  });

  describe('POST /api/auth/logout-everywhere', () => {
    it('kills every session for that manager but leaves others alone', async () => {
      const first = sessionCookieFrom(
        await post('/api/auth/login', { username: 'tom', password: PASSPHRASE }),
      )!;
      const second = sessionCookieFrom(
        await post('/api/auth/login', { username: 'tom', password: PASSPHRASE }),
      )!;
      const other = sessionCookieFrom(
        await post('/api/auth/login', {
          username: 'zac',
          password: 'elder-hoop-meteor-muzzle-cotton-brass',
        }),
      )!;

      expect(first).not.toBe(second);
      await post('/api/auth/logout-everywhere', undefined, first);

      for (const cookie of [first, second]) {
        const response = await request('/api/auth/me', { headers: { cookie } });
        expect(await response.json()).toEqual({ user: null });
      }

      const stillOn = await request('/api/auth/me', { headers: { cookie: other } });
      expect(await stillOn.json()).toMatchObject({ user: { username: 'zac' } });
    });

    it('requires a session', async () => {
      expect((await post('/api/auth/logout-everywhere')).status).toBe(401);
    });
  });

  describe('session storage', () => {
    it('stores only a digest, never the token itself', async () => {
      const login = await post('/api/auth/login', { username: 'tom', password: PASSPHRASE });
      const cookie = sessionCookieFrom(login)!;
      const token = cookie.replace('mbl_session=', '');

      const rows = await getDb(testEnv).select().from(sessions).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tokenHash).not.toBe(token);
      expect(rows[0]!.tokenHash).not.toContain(token);
    });
  });
});
