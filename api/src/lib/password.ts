/**
 * Password hashing and passphrase generation.
 *
 * PBKDF2-SHA256 through WebCrypto, which is native on Workers. `bcryptjs` is
 * deliberately absent: pure-JS bcrypt is far too slow for the platform's CPU
 * budget.
 *
 * ## Why the iteration count is low, and why that's still sound
 *
 * The Workers free plan allows 10 ms of CPU per invocation, which is well
 * under what OWASP's recommended 600,000 PBKDF2-SHA256 iterations costs. Rather
 * than pretend otherwise, this design shifts the work to the *secret*: the
 * commissioner issues generated 6-word passphrases (48 bits, see wordlist.ts)
 * instead of letting managers choose their own. KDF stretching exists to make
 * dictionary attacks on low-entropy human passwords expensive; against a
 * uniformly random 48-bit secret there is no dictionary to try, so the
 * iteration count stops being the thing that matters.
 *
 * Concretely: 48 bits of entropy at 50,000 iterations means an attacker holding
 * a stolen database must compute 2^48 x 50,000 ~= 1.4e19 SHA-256 operations to
 * break one account. At a generous 1e10 hashes/second that is ~44 years per
 * account. The low iteration count is affordable precisely because the secret
 * is random.
 *
 * ITERATIONS is a measured value, not an aspiration — see `npm run
 * bench-password`. Raise it only alongside a real measurement.
 */

import { BITS_PER_WORD, WORDLIST } from './wordlist';

const ALGORITHM = 'pbkdf2-sha256';

/**
 * Measured, not chosen. `npm run bench-password` on this machine:
 *
 *    50,000 ->  5.4 ms   ok
 *   100,000 -> 10.6 ms   over the 10 ms budget
 *   600,000 -> 60.4 ms   6x over (this is OWASP's recommendation)
 *
 * 50,000 leaves roughly 4 ms of the invocation budget for the session insert
 * and response. Re-run the benchmark before raising this.
 */
export const ITERATIONS = 50_000;

const SALT_BYTES = 16;
const DERIVED_BITS = 256;

/** Words per generated passphrase. 6 x 8 bits = 48 bits of entropy. */
export const PASSPHRASE_WORDS = 6;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * `Uint8Array<ArrayBuffer>` rather than plain `Uint8Array`: since TypeScript 5.7
 * the latter widens to `ArrayBufferLike`, which admits `SharedArrayBuffer` and
 * so isn't assignable to WebCrypto's `BufferSource`.
 */
async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    DERIVED_BITS,
  );
  return new Uint8Array(bits);
}

/** Length-independent comparison, so a mismatch reveals nothing by timing. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * Hash for storage in `users.password_hash`. The format is self-describing —
 * `pbkdf2-sha256$<iterations>$<salt>$<derived>` — so ITERATIONS can be raised
 * later without invalidating existing hashes.
 */
export async function hashPassword(
  password: string,
  iterations: number = ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derive(password, salt, iterations);
  return `${ALGORITHM}$${iterations}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
}

/**
 * Verify against a stored hash. Returns false for malformed or unknown-algorithm
 * records rather than throwing, so a corrupt row is a failed login and not a 500.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4) return false;

  const [algorithm, iterationsRaw, saltRaw, derivedRaw] = parts as [
    string,
    string,
    string,
    string,
  ];
  if (algorithm !== ALGORITHM) return false;

  const iterations = Number.parseInt(iterationsRaw, 10);
  if (!Number.isInteger(iterations) || iterations < 1) return false;

  try {
    const expected = fromBase64Url(derivedRaw);
    const actual = await derive(password, fromBase64Url(saltRaw), iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * A hyphen-joined passphrase, e.g. "otter-maple-cliff-torch-basin-glide".
 *
 * One random byte per word indexes the 256-word list directly — no modulo, so
 * every word is equally likely and the entropy is exactly
 * `words * BITS_PER_WORD`.
 */
export function generatePassphrase(words: number = PASSPHRASE_WORDS): string {
  const bytes = crypto.getRandomValues(new Uint8Array(words));
  return Array.from(bytes, (byte) => WORDLIST[byte]!).join('-');
}

/** Entropy of a passphrase produced by `generatePassphrase`. */
export function passphraseBits(words: number = PASSPHRASE_WORDS): number {
  return words * BITS_PER_WORD;
}
