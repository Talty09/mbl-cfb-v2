# Completed paper-draft import

The importer treats `api/seeds/2026-paper-draft.csv` as the authoritative pick order and resolves every selected team against ids exported from the target D1 database. It does not read or write user passwords.

## Export the target database's teams

Use the same target for the export and eventual import. The generator accepts Wrangler JSON, a raw JSON row array, or an `id,school` CSV.

```bash
# Local D1
npx wrangler d1 execute mbl --local \
  --command "SELECT id, school FROM teams ORDER BY school" \
  --json > /tmp/mbl-teams.json

# Remote D1 (when ready)
npx wrangler d1 execute mbl --remote \
  --command "SELECT id, school FROM teams ORDER BY school" \
  --json > /tmp/mbl-teams.json
```

## Validate and generate SQL

```bash
npm run paper-draft:build -- /tmp/mbl-teams.json
```

This writes the gitignored, transient migration `api/paper-draft-migrations/20260909_2026_completed_paper_draft.sql`. Generation aborts unless the input has exactly 100 unique picks, 10 known managers, 10 rounds in snake order, and one exact canonical D1 team match per pick. Paper names that differ from D1 names must be listed explicitly in `TEAM_NAME_ALIASES`.

The generated migration deterministically replaces only the selected season's `draft_order` and `picks`, then sets `draft_status` to `complete`. It does not modify `users`, sessions, or password hashes. The dedicated `wrangler.paper-draft.jsonc` makes Wrangler apply it through D1's migration system, which captures a backup and rolls the migration back if any statement fails.

## Apply

Inspect the generated migration first, then apply it to the same target used for the team export:

```bash
npm run paper-draft:local
# or, after local verification:
npm run paper-draft:remote
```

Do not run this file with `wrangler d1 execute`: D1 does not support client-managed `BEGIN TRANSACTION`. The migration command supplies the atomic boundary. Once a target records this migration as applied, it becomes a no-op on later runs.
