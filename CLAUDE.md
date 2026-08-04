# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Most Baller League (MBL) v2 — a fantasy college football web app for an 11-person friends league. Each manager drafts 10 real FBS teams in a live snake draft, then earns points as those teams win games. The app must support: login, a live draft room, a scoreboard with fantasy point attribution, season standings, past scores by week, manager rosters ("Locker Room"), and a group chat ("Trash Talk").

**Stack: one Cloudflare Worker + D1, entirely on the free tier.** An npm workspaces monorepo — `web/` (Angular 21 SPA), `api/` (the Worker: Hono + Drizzle), `shared/` (zod request schemas and response types used by both). The Worker serves the SPA from its assets binding and the API at `/api/*` in a single deploy, so there is no CORS and no second service. The Express/Prisma/PostgreSQL/socket.io scaffold this replaced is preserved in the first commit if it's ever needed.

Not yet deployed: `wrangler.jsonc` still has a placeholder `database_id`. `npx wrangler login` and `npx wrangler d1 create mbl` are the one-time interactive steps.

## League Rules (source of truth)

These are the official rules confirmed by the league owner. They are NOT fully documented anywhere else — the design handoff README and the v1 codebase both contain an outdated/incomplete version (flat 1/2 points for everything). This table wins any conflict:

| Result | Points |
|--------|--------|
| Win (any game) | 1 |
| Win vs. AP Top 25 team (regular season only) | 2 |
| Bowl game win | 2 |
| Conference championship win | 3 |
| Playoff win | 3 |
| National championship win | 4 |

- Loss or tie = 0 points, always.
- Top 25 = AP Poll **from the week the game was played**. Membership matters, not rank position. The Top 25 bonus applies to regular-season games only.
- CFP games hosted at bowls (quarterfinals/semis at Rose, Sugar, etc.) count as **playoff wins (3)**, not bowl wins (2). "Bowl game win" means non-playoff bowls. The national championship game pays 4 (not 3+4).
- 11 managers, each owns exactly 10 FBS teams. Ownership is **exclusive** — one owner per team, league-wide.
- Rosters are set by a **snake draft** (10 rounds) before the season; no trades or waivers.
- **There is no pick clock** (league owner's decision). The draft is asynchronous and may run for days; the commissioner nudges whoever is on the clock in the league's Facebook chat. The Draft Room therefore shows how long the current manager has been up, not a countdown — this supersedes the 90-second timer in the design handoff. The commissioner can also pick on an unreachable manager's behalf.
- Login is by **username**, not email (`tom`, `josh.bozym`). The seeded email addresses were placeholders and the column is gone.
- Standings = total points, descending. No tiebreaker has been defined yet — ask the league owner before inventing one.
- Only completed games score. Season data comes from the College Football Data API (https://api.collegefootballdata.com), FBS classification, regular + postseason.

## Design Handoff (UI source of truth)

`design_handoff_mbl/README.md` is the authoritative spec for layout, behavior, and design tokens (colors, Barlow/Barlow Condensed typography, spacing, motion). Screenshots of all seven views are in `design_handoff_mbl/screenshots/`. Fidelity is **high** — match tokens closely.

- `Most Baller League.dc.html` is a browser-viewable prototype built on a proprietary `<x-dc>`/`DCLogic` runtime. Use it as a visual/behavioral reference only; **do not port that runtime or copy its code**.
- The mock uses hardcoded data (including a fictional "chris" manager and "Week 9 · 2026") — all of it gets replaced by real API/DB data.
- Auth gates **write** actions (drafting, chatting); read views are browsable without signing in ("Browse without signing in" → guest).
- `Fantasy College Football Site.zip` is just a duplicate of the extracted `design_handoff_mbl/` folder.

## Version 1 Reference

V1 lives at `C:\dev\TestApps\mbl-league-v1` (github.com/Talty09/mbl-league): Angular 20 standalone + Express + Prisma/PostgreSQL, with the Express server acting mostly as a thin proxy to the CFBD API (auth key server-side, `CFBD_API_KEY` env var). Useful as reference for:

- CFBD field naming: **v1's interfaces are stale and its own code disagrees with itself** — `server/models/games.model.ts` declares `home_id`/`away_id` while `.backup/score.service.ts` uses `game.homeId`. Verified against live responses: `/games`, `/calendar`, `/rankings` and `/teams/fbs` are all **camelCase**. v1's `TeamRanking` also omits `teamId`, which the real payload does include. Trust `api/src/services/ingest/schemas.ts` over anything in v1. v1's captured responses in `server/mock_data/*.json` are genuine and useful.
- Scoring pipeline structure: `client/.../services/score.service.ts` (fetch games → enrich with per-week AP Top 25 flags → filter to completed weeks → per-user points → group by week). The *structure* is sound; the *point values* are the outdated flat rules and postseason games were scored like regular ones — do not copy the values.
- Seed data: `server/seed_data/users.csv` (the 11 real managers) and `user_teams.csv` (2025 rosters, 110 rows).
- Do not carry forward: v1 had no auth, no draft (rosters hand-edited in CSV), no chat, and an abandoned broken live-scoring attempt in `.backup/score.service.ts`.

## Architecture

One Worker, one D1 database, one deploy. Three decisions shape everything else:

**CFBD is ingest-only and never on a read path.** A cron trigger pulls teams, the calendar, games and AP polls into D1 and materializes scoring into `game_points`; the seven views read nothing but our own database. v1 and the original v2 scaffold both proxied CFBD per page load, which made every view depend on a third party.

**Ownership has exactly one source of truth: the `picks` table.** A roster is a query over picks. The scaffold had both `draft_picks` and `roster_spots` encoding the same fact, which could drift.

**No realtime channel.** socket.io cannot run on Workers, and cross-client fanout would need Durable Objects (paid). For an eleven-person league with a multi-day draft, polling is correct rather than a compromise: clients poll only `GET /api/pulse`, a tiny change-detector, and refetch a real resource when its counter moves. Polling is gated on tab visibility.

### The free-tier limits that drive the design

| Limit | Free plan | Consequence |
|---|---|---|
| Worker CPU per invocation | **10 ms** | Caps PBKDF2 iterations (see Auth); forces the ingest to do one slice per cron firing; aggregation belongs in SQL, since D1 query time is I/O and doesn't count |
| Worker requests/day | 100,000 | Visibility-gated polling of one tiny endpoint. Asset requests bypass the Worker and aren't billed against this |
| D1 bound parameters per statement | low | Multi-row inserts are chunked — see `insertChunked` in `api/src/lib/db.ts`; 138 teams or a week of games exceed one statement |
| D1 queries per invocation | 50 | Never issue one query per manager/team/message |
| D1 rows read/written per day | 5M / 100k | Why `sessions.lastSeenAt` is only rewritten once a minute |

### Auth

Username + a commissioner-issued passphrase; an opaque session token in an httpOnly cookie. Read views work for guests, writes are gated.

PBKDF2-SHA256 via WebCrypto at **50,000 iterations** — measured, not chosen: 100k costs 10.6 ms and OWASP's recommended 600k costs 60 ms, both over the 10 ms ceiling (`npm run bench-password`). The security argument moves to the secret instead: generated 6-word passphrases from a 256-word list, exactly 48 bits, one random byte per word so there's no modulo bias. Do not raise the iteration count without re-measuring, and do not switch to user-chosen passwords — that combination would genuinely be weak.

Sessions are opaque rather than JWTs because verification is one indexed read (I/O, not CPU), revocation is a `DELETE`, and there's no signing secret. Only the SHA-256 of the token is stored.

## Commands

All from the repo root — it's an npm workspaces monorepo, one `npm install`, one lockfile. No Docker, no Postgres, no local database server: D1 is a real SQLite file under `.wrangler/state`.

```bash
npm run dev            # wrangler dev on :8787 + ng serve on :4200 (proxying /api)
npm run build          # production Angular build (what wrangler deploys as assets)
npm run typecheck      # all workspaces
npm test               # all workspaces
npm run deploy         # build + wrangler deploy

npm run db:generate    # drizzle-kit: schema.ts -> api/migrations/*.sql
npm run db:migrate:local     # wrangler d1 migrations apply mbl --local
npm run db:migrate:remote    # ...--remote
npm run seed:build     # generate api/seeds/managers.sql + print fresh passphrases
npm run seed:local     # apply it
npm run cf-typegen     # regenerate worker-configuration.d.ts after binding changes
npm run bench-password # measure PBKDF2 cost against the 10 ms budget
```

Copy `.dev.vars.example` to `.dev.vars` and set `CFBD_API_KEY` (production uses `wrangler secret put`).

Single test file: `cd api && npx vitest run src/routes/auth.test.ts`

### Testing notes that will otherwise cost an hour

- Worker tests run **inside workerd** via `@cloudflare/vitest-pool-workers`, against a real D1 with the real migrations applied — `crypto.subtle` and the bindings are genuine.
- That package's 0.19 release **removed `defineWorkersConfig` and its `./config` subpath**; use the `cloudflareTest` Vite plugin (see `api/vitest.config.ts`). Most examples online still show the old form and won't resolve.
- `readD1Migrations` must run in `vitest.config.ts` (Node) and reach tests as a binding. Importing it inside a test fails in workerd with `No such module "node:process"`.
- `isolatedStorage` isolates per test **file**, not per test, so `migrate()` resets every table and belongs in `beforeEach`.
- `wrangler dev --test-scheduled` does **not** work here: `/__scheduled` sits behind the SPA asset fallback and the fetch handler forwards non-`/api` paths to `ASSETS`, so it returns `index.html` and a misleading 200. Test the cron by calling the exported `scheduled` handler directly (`api/src/index.test.ts`), or force a slice at runtime with `POST /api/admin/sync`.

## Codebase Notes

- **Worker layout**: `api/src/routes/` (Hono routers, mounted in `app.ts`), `api/src/services/` (pure, unit-tested logic — keep free of I/O), `api/src/services/ingest/` (CFBD slices + the pure stage-selection policy in `plan.ts`), `api/src/lib/` (D1/Drizzle client, CFBD fetch+zod wrapper, password, session, encoding, season helpers), `api/src/middleware/`, `api/src/db/schema.ts`, `api/migrations/`.
- **Scoring lives in `api/src/services/scoring.ts`** — `pointsForWin`, `classifyGame`, `pointsForGame`. Any rule change goes there and in its tests, nowhere else. Do **not** restate point values in SQL: `game_points` is materialized by `services/points.ts` calling those functions, precisely so the rules have one home. `scoring.classification.test.ts` pins the heuristics against real captured 2025 CFBD labels.
- **Draft is server-authoritative**: turn and exclusivity are validated in `routes/draft.ts`, but the DB uniques on `(season_year, team_id)` and `(season_year, pick_number)` are the actual guarantee — application checks exist for good error messages. Both are verified to fire.
- **`shared/` has two entry points on purpose.** `shared` (the barrel) is client-safe: domain vocabulary and response types only. The zod request schemas live behind `shared/requests` and are imported **only** by the Worker. Barrelling them together put a 328 kB chunk of zod into the browser bundle (254 → 582 kB initial). Keep them separate.
- **`Env` is generated, not hand-written**: `worker-configuration.d.ts` comes from `wrangler.jsonc` via `npm run cf-typegen` and is committed so typechecking and CI don't need wrangler. `api/src/types.ts` just aliases `Cloudflare.Env`. Hand-writing it drifts, and `cloudflare:test` hands integration tests the generated type anyway.
- **Client conventions**: Angular 21 zoneless with signals; pages in `web/src/app/pages/<name>/<name>.page.ts` lazy-loaded from `app.routes.ts`. `web/src/app/core/` holds `ApiService` (typed `/api` access), `PulseService` (the single visibility-gated poller — see Architecture), `AuthService`, and `models.ts` (re-exports from `shared`). There is **no HTTP interceptor**: the session is an httpOnly cookie the browser attaches to same-origin requests itself. Design tokens are CSS custom properties (`--mbl-*`) in `styles.scss`, with shared `.mbl-card` / `.mbl-label` / `.mbl-input` / `.mbl-btn-primary` / `.mbl-btn-outline` classes and the `mblPulse` keyframes — use them, never raw hex.
- **2026 is a fresh start (league owner's decision)**: v1's 2025 rosters and history are intentionally not imported — the seed creates only the 11 managers and season 2026. If 2025 data is ever wanted, v1's `user_teams.csv` (in the v1 repo) keys rosters by v1-database UUIDs, so a UUID→email mapping would have to be built first.
