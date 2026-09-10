/** Generate one manager passphrase and a one-row reset SQL file. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generatePassphrase, hashPassword, passphraseBits } from '../src/lib/password';

const username = process.argv[2]?.trim().toLowerCase();
if (!username || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(username)) {
  throw new Error('Usage: npm run password:build -- <username>');
}

const passphrase = generatePassphrase();
const hash = await hashPassword(passphrase);
const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;
const output = resolve(import.meta.dirname, '..', 'seeds', 'password-reset.sql');
const sql =
  `UPDATE users SET password_hash = ${sqlString(hash)} WHERE username = ${sqlString(username)};\n` +
  `SELECT username, changes() AS passwords_updated FROM users WHERE username = ${sqlString(username)};\n`;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, sql, 'utf8');

console.log(`Wrote ${output}`);
console.log(`Username: ${username}`);
console.log(`Passphrase (${passphraseBits()} bits): ${passphrase}`);
console.log('Share this passphrase privately; it is not stored in plaintext.');
