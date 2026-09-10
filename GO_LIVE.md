# MBL 2026 go-live runbook

## What is already in place

- Worker: `https://mbl.tom-talty.workers.dev`
- D1 database: `mbl` (`32c2c555-e6b0-447b-99c6-847e596bf5be`)
- GitHub workflow: `.github/workflows/deploy.yml`
  - Pull requests run typecheck, tests, and the production build.
  - A merge/push to `main` runs the same checks, applies normal schema migrations, and deploys the Worker and Angular assets.
- Current production check on 2026-09-09: the Worker answers, but D1 has no managers, teams, picks, or games. `/api/meta` reports a CFBD 401, so the production `CFBD_API_KEY` must be replaced before data sync will work.

## 1. Authenticate this workstation

From the repository root:

```bash
npx wrangler login
npx wrangler whoami
```

Do not paste Cloudflare or CFBD tokens into Git, an issue, or chat.

## 2. Configure GitHub-to-Cloudflare deployment

In Cloudflare, create a narrowly scoped API token for the account containing `mbl`. It needs permission to deploy Workers and update D1; scope it to this Cloudflare account (and the eventual zone if zone access is included).

In GitHub, open `Talty09/mbl-cfb-v2` → Settings → Environments → `production`, then add environment secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The existing workflow deploys only after changes reach `main`. Turn on branch protection for `main` and require the `Typecheck, test, build` check plus at least one approval. That makes an approved-and-merged pull request the production release mechanism; approval alone does not deploy until the PR is merged.

Official setup: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/

## 3. Set the CFBD production secret

```bash
npx wrangler secret put CFBD_API_KEY
```

Paste the active CollegeFootballData key at Wrangler's prompt. Then deploy the code or wait for the GitHub workflow after merge.

## 4. Apply schema and seed login accounts

```bash
npm run db:migrate:remote
npm run seed:build | tee /tmp/mbl-2026-credentials.txt
npm run seed:remote
```

`seed:build` creates fresh six-word passphrases for all 11 login accounts and prints them once. It does not put plaintext passwords in Git. Treat `/tmp/mbl-2026-credentials.txt` as sensitive and delete it after distribution. Running `seed:build` plus `seed:remote` again rotates every manager's password, so do not rerun it casually.

## 5. Load teams, the paper draft, and Week 1

First deploy the corrected Worker. Sign in as commissioner and run the team sync from the browser/API, or let the cron run after the CFBD key is fixed. Confirm the team table is populated:

```bash
npx wrangler d1 execute mbl --remote \
  --command "SELECT id, school FROM teams ORDER BY school" \
  --json > /tmp/mbl-teams.json

npm run paper-draft:build -- /tmp/mbl-teams.json
npm run paper-draft:remote
```

The draft generator requires exactly 100 unique teams and the confirmed 10-manager snake order. It excludes `josh.yagel` from the 2026 competition without deleting his login. The generated draft is applied through a dedicated atomic D1 migration, not raw `d1 execute`; see `PAPER_DRAFT_IMPORT.md`.

Use the commissioner-only `POST /api/admin/sync` endpoint in this order:

```json
{"slice":"games","season":2026,"week":1,"seasonType":"regular"}
{"slice":"rankings","season":2026,"week":1,"seasonType":"regular"}
{"slice":"points","season":2026,"week":1,"seasonType":"regular"}
```

Repeat the three calls once. They are idempotent; totals should not change on the second pass. An empty regular-season AP poll is rejected instead of silently under-scoring ranked wins.

## 6. Verify production before inviting players

Read back the exact target:

```bash
npx wrangler d1 execute mbl --remote --command \
"SELECT
 (SELECT count(*) FROM users) AS users,
 (SELECT count(*) FROM draft_order WHERE season_year=2026) AS participants,
 (SELECT count(*) FROM picks WHERE season_year=2026) AS picks,
 (SELECT count(*) FROM games WHERE season=2026 AND week=1 AND season_type='regular') AS week1_games,
 (SELECT count(*) FROM poll_ranks WHERE season=2026 AND week=1 AND season_type='regular' AND poll='AP Top 25') AS week1_ap_rows,
 (SELECT coalesce(sum(points),0) FROM game_points WHERE season=2026 AND week=1 AND season_type='regular') AS week1_points;"
```

Expected structural values are 11 login users, 10 participants, and 100 picks. Inspect the actual Week 1 game, poll, and point counts rather than hard-coding them.

Also verify:

- `https://<production-host>/api/meta`
- `https://<production-host>/api/draft`
- `https://<production-host>/api/scoreboard?week=1&seasonType=regular`
- `https://<production-host>/api/weeks/1/scores?seasonType=regular`
- `https://<production-host>/api/standings`
- `https://<production-host>/api/rosters`

## 7. Purchase and attach a domain

Buy the domain from Cloudflare Registrar or another registrar, then add it as an active Cloudflare zone. In Cloudflare: Workers & Pages → `mbl` → Settings → Domains & Routes → Add → Custom Domain. Enter the exact hostname, such as `mbl.example.com`. Cloudflare creates the DNS record and certificate.

Official guide: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/

Keep the `workers.dev` address enabled until the custom hostname is serving the same `/api/meta` response and the login page loads over HTTPS.

## 8. Distribute player credentials

Send each person only their own username and six-word passphrase through a private channel (individual text, Signal, or password-manager share), never the group chat. Include the production URL and tell them the username is lowercase.

Suggested message:

> MBL is live: https://<your-domain>. Your username is `<username>` and your temporary league passphrase is `<six-word-passphrase>`. Sign in, save it in your password manager, and use Trash Talk responsibly—or at least creatively.

Josh Yagel may sign in and use Trash Talk, but he will not appear in 2026 standings or rosters. Test one non-commissioner account before sending all ten competitive-player messages.

To rotate one person's password later without changing everyone else's:

```bash
npm run password:build -- <username>
npm run password:remote
```

Confirm the command reports `passwords_updated: 1`, privately send the newly printed passphrase, then delete `api/seeds/password-reset.sql`.
