import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from './index';
import { sessions } from './db/schema';
import { getDb } from './lib/db';
import { migrate, seedManagers, testEnv } from './test/helpers';

/**
 * The cron handler, invoked directly.
 *
 * `wrangler dev --test-scheduled` cannot reach this: its /__scheduled hook sits
 * behind the static-asset SPA fallback, and the fetch handler forwards every
 * non-/api path to ASSETS regardless. Calling the export is both simpler and a
 * closer test of the thing that actually runs in production.
 */
async function runScheduled(): Promise<void> {
  const ctx = createExecutionContext();
  await worker.scheduled(
    { scheduledTime: Date.now(), cron: '*/5 * * * *', noRetry: () => {} },
    env,
    ctx,
  );
  // Maintenance is handed to waitUntil, so the test has to wait for it too.
  await waitOnExecutionContext(ctx);
}

async function addSession(id: string, expiresAt: Date): Promise<void> {
  await getDb(testEnv)
    .insert(sessions)
    .values({
      id,
      userId: 'usr_tom',
      tokenHash: `hash-${id}`,
      createdAt: new Date(0),
      lastSeenAt: new Date(0),
      expiresAt,
    });
}

async function sessionIds(): Promise<string[]> {
  const rows = await getDb(testEnv).select({ id: sessions.id }).from(sessions).all();
  return rows.map((row) => row.id).sort();
}

describe('scheduled handler', () => {
  beforeEach(async () => {
    await migrate();
    await seedManagers([{ username: 'tom', password: 'x', isCommissioner: true }]);
  });

  it('reaps expired sessions and leaves live ones alone', async () => {
    await addSession('expired', new Date(Date.now() - 60_000));
    await addSession('live', new Date(Date.now() + 60_000));

    await runScheduled();

    expect(await sessionIds()).toEqual(['live']);
  });

  it('does not throw when CFBD is unreachable', async () => {
    // The ingest slice records its own failure in sync_state and the handler
    // swallows it, so a CFBD outage must never surface as a cron error.
    await expect(runScheduled()).resolves.toBeUndefined();
  });

  it('still runs maintenance even if the ingest slice fails', async () => {
    await addSession('expired', new Date(Date.now() - 60_000));

    // Whatever the ingest does — skip in the offseason, or fail against CFBD —
    // housekeeping is outside its error path.
    await runScheduled();

    expect(await sessionIds()).not.toContain('expired');
  });
});

describe('fetch handler', () => {
  beforeEach(migrate);

  it('routes /api paths to the API', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request('https://mbl.test/api/auth/me'),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: null });
  });

  it('returns a JSON 404 for an unknown API path rather than the SPA', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request('https://mbl.test/api/nope'), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});
