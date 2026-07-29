/**
 * Measure PBKDF2 cost so ITERATIONS in lib/password.ts is a measured value
 * rather than a guess.
 *
 * Caveat worth keeping in mind: this runs in Node, and the number that actually
 * matters is *CPU* time inside workerd against the 10 ms free-plan limit. Both
 * use a native SHA-256, so this is a good proxy for choosing a starting point —
 * confirm against real CPU time in the Cloudflare dashboard after deploying.
 *
 *   npm run bench-password
 */

import { generatePassphrase, hashPassword, verifyPassword } from '../src/lib/password';

const CANDIDATES = [50_000, 100_000, 200_000, 310_000, 600_000];
const SAMPLES = 5;

/** The 10 ms free-plan CPU ceiling, minus headroom for the rest of the request. */
const BUDGET_MS = 10;
const TARGET_MS = 6;

async function timeVerify(iterations: number): Promise<number> {
  const password = generatePassphrase();
  const stored = await hashPassword(password, iterations);

  const timings: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const start = performance.now();
    const ok = await verifyPassword(password, stored);
    timings.push(performance.now() - start);
    if (!ok) throw new Error(`verifyPassword failed at ${iterations} iterations`);
  }
  timings.sort((a, b) => a - b);
  return timings[Math.floor(timings.length / 2)]!;
}

console.log(`PBKDF2-SHA256 verify cost (median of ${SAMPLES}), Node proxy for workerd`);
console.log(`Budget: ${BUDGET_MS} ms CPU per invocation; targeting <= ${TARGET_MS} ms\n`);
console.log('iterations   median ms   verdict');

let recommended = CANDIDATES[0]!;
for (const iterations of CANDIDATES) {
  const ms = await timeVerify(iterations);
  const verdict = ms <= TARGET_MS ? 'ok' : ms <= BUDGET_MS ? 'tight' : 'OVER BUDGET';
  if (ms <= TARGET_MS) recommended = iterations;
  console.log(
    `${String(iterations).padStart(10)}   ${ms.toFixed(2).padStart(9)}   ${verdict}`,
  );
}

console.log(`\nHighest iteration count within the ${TARGET_MS} ms target: ${recommended}`);
console.log('Set ITERATIONS in api/src/lib/password.ts to this value.');
