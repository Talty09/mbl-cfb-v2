/**
 * Validate the authoritative 2026 paper draft against a real D1 team export and
 * generate an idempotent SQL import. This does not create or update users, so it
 * cannot rotate manager passwords.
 *
 *   npm run paper-draft:build -- /tmp/mbl-teams.json
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generatePaperDraftSql, parseTeamExport } from '../src/services/paper-draft';

const SEASON = 2026;
const DRAFT_PATH = resolve(import.meta.dirname, '..', 'seeds', '2026-paper-draft.csv');
const MIGRATION_DIR = resolve(import.meta.dirname, '..', 'paper-draft-migrations');
const MIGRATION_PATH = resolve(
  import.meta.dirname,
  '..',
  'paper-draft-migrations',
  '20260909_2026_completed_paper_draft.sql',
);

function usage(): never {
  throw new Error(
    'Usage: npm run paper-draft:build -- <teams.json|teams.csv>\n' +
      'Export exactly `SELECT id, school FROM teams ORDER BY school` from D1.',
  );
}

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] === '--help' || args[0] === '-h') usage();

const teamExportPath = resolve(process.cwd(), args[0]!);
const draftCsv = readFileSync(DRAFT_PATH, 'utf8');
const teams = parseTeamExport(readFileSync(teamExportPath, 'utf8'));
const sql = generatePaperDraftSql({ season: SEASON, csv: draftCsv, teams });
// This directory is dedicated to one generated, one-time data migration. Clear
// stale generated names so Wrangler cannot apply two versions of the same draft.
rmSync(MIGRATION_DIR, { recursive: true, force: true });
mkdirSync(dirname(MIGRATION_PATH), { recursive: true });
writeFileSync(MIGRATION_PATH, sql, 'utf8');

console.log(`Validated 100 picks, 10 managers, 10 rounds, and ${teams.length} exported teams.`);
console.log(`Wrote ${MIGRATION_PATH}`);
console.log('No users or password hashes are written by this import.');
