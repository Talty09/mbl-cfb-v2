import { describe, expect, it } from 'vitest';
import {
  generatePassphrase,
  hashPassword,
  ITERATIONS,
  passphraseBits,
  PASSPHRASE_WORDS,
  verifyPassword,
} from './password';
import { WORDLIST } from './wordlist';

describe('hashPassword / verifyPassword', () => {
  it('accepts the correct password', async () => {
    const stored = await hashPassword('otter-maple-cliff-torch-basin-glide');
    expect(await verifyPassword('otter-maple-cliff-torch-basin-glide', stored)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const stored = await hashPassword('otter-maple-cliff-torch-basin-glide');
    expect(await verifyPassword('otter-maple-cliff-torch-basin-glid', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('salts each hash, so identical passwords store differently', async () => {
    const a = await hashPassword('same-password-both-times-here-ok');
    const b = await hashPassword('same-password-both-times-here-ok');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password-both-times-here-ok', a)).toBe(true);
    expect(await verifyPassword('same-password-both-times-here-ok', b)).toBe(true);
  });

  it('records the algorithm and iteration count in the stored format', async () => {
    const stored = await hashPassword('whatever-passphrase-goes-here');
    const [algorithm, iterations, salt, derived] = stored.split('$');
    expect(algorithm).toBe('pbkdf2-sha256');
    expect(Number(iterations)).toBe(ITERATIONS);
    // 16-byte salt and 32-byte key, base64url with padding stripped.
    expect(salt).toHaveLength(22);
    expect(derived).toHaveLength(43);
  });

  it('still verifies hashes written at a different iteration count', async () => {
    // Guards the upgrade path: raising ITERATIONS must not lock anyone out.
    const stored = await hashPassword('legacy-hash-passphrase-value', 1_000);
    expect(stored).toContain('$1000$');
    expect(await verifyPassword('legacy-hash-passphrase-value', stored)).toBe(true);
  });

  it('treats malformed or unknown-algorithm records as a failed login, not an error', async () => {
    await expect(verifyPassword('x', '')).resolves.toBe(false);
    await expect(verifyPassword('x', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword('x', 'bcrypt$10$abc$def')).resolves.toBe(false);
    await expect(verifyPassword('x', 'pbkdf2-sha256$notanumber$abc$def')).resolves.toBe(false);
    await expect(verifyPassword('x', 'pbkdf2-sha256$0$abc$def')).resolves.toBe(false);
  });
});

describe('generatePassphrase', () => {
  it('produces the configured number of words from the list', () => {
    const words = generatePassphrase().split('-');
    expect(words).toHaveLength(PASSPHRASE_WORDS);
    for (const word of words) expect(WORDLIST).toContain(word);
  });

  it('does not repeat itself across many draws', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generatePassphrase()));
    expect(seen.size).toBe(200);
  });

  it('reports entropy that matches the 256-word list', () => {
    expect(WORDLIST).toHaveLength(256);
    expect(passphraseBits()).toBe(48);
    expect(passphraseBits(4)).toBe(32);
  });
});
