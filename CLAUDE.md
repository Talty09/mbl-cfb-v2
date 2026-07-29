# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Most Baller League (MBL) v2 — a fantasy college football web app for an 11-person friends league. Each manager drafts 10 real FBS teams in a live snake draft, then earns points as those teams win games. The app must support: login, a live draft room, a scoreboard with fantasy point attribution, season standings, past scores by week, manager rosters ("Locker Room"), and a group chat ("Trash Talk").

**Current state: scaffolded.** `client/` is an Angular 21 standalone app (zoneless, signals, SCSS) with the app shell, design tokens, auth, and all seven views routed (Trash Talk is fully wired; the other views are structured stubs awaiting data wiring). `server/` is Express 5 + Prisma 6 + socket.io with auth, draft, chat, and CFBD-proxy routes implemented and the scoring/draft engines unit-tested. No database migration has been generated yet (needs a running PostgreSQL — run `npm run db:migrate` in `server/` once `DATABASE_URL` is configured).

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
- Rosters are set by a live **snake draft** (10 rounds, 90-second pick clock) at the start of the season; no trades or waivers.
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

- CFBD API integration: endpoint shapes, the proxy route pattern (`server/routes/*.ts`), and the quirk that CFBD responses mix `snake_case` and `camelCase` (game team IDs are `homeId`/`awayId` — always verify actual responses before writing interfaces).
- Scoring pipeline structure: `client/.../services/score.service.ts` (fetch games → enrich with per-week AP Top 25 flags → filter to completed weeks → per-user points → group by week). The *structure* is sound; the *point values* are the outdated flat rules and postseason games were scored like regular ones — do not copy the values.
- Seed data: `server/seed_data/users.csv` (the 11 real managers) and `user_teams.csv` (2025 rosters, 110 rows).
- Do not carry forward: v1 had no auth, no draft (rosters hand-edited in CSV), no chat, and an abandoned broken live-scoring attempt in `.backup/score.service.ts`.

## Intended Architecture

Same stack family as v1 unless the league owner decides otherwise: Angular standalone client + Node/Express server + Prisma/PostgreSQL, CFBD API proxied through the server.

New ground v2 must break beyond v1:

- **Auth**: real email+password login against the users table, session/JWT, guards on draft picks and chat posts.
- **Draft room**: server-authoritative snake draft state (picks table with order/round, on-the-clock derivation, 90s clock, exclusivity enforcement) with live updates to all connected managers — this and chat need a realtime channel (WebSocket/SSE), which v1 never had.
- **Chat**: persisted messages table, posted under the signed-in manager.
- **Scoring engine**: implement the full rules table above. Requires classifying each postseason game (non-playoff bowl vs. conference championship vs. CFP round vs. title game) from CFBD data (`seasonType`, game notes/names) — v1 has no game-type classification at all.
- **DB**: v1 only had `users` and `user_teams`; v2 adds at least draft picks, chat messages, and likely a season/league-year dimension so rosters and scores are per-season.

## Commands

### Server (from `server/`)

```bash
npm run dev            # tsx watch — dev server on http://localhost:3000
npm run build          # tsc → dist/
npm run typecheck      # tsc --noEmit
npm test               # vitest run (scoring + draft engine tests)
npx vitest run src/services/scoring.test.ts   # single test file
npm run db:migrate     # prisma migrate dev (needs DATABASE_URL)
npm run db:seed        # seed users/seasons/draft slots from seed_data/ CSVs
npm run db:studio      # Prisma Studio GUI
```

Copy `.env.example` to `.env` first (CFBD key, Postgres URLs, JWT secret). The database is plain PostgreSQL, intended to be hosted on Supabase in production: `DATABASE_URL` is the pooled connection (port 6543, `?pgbouncer=true` on Supabase) and `DIRECT_URL` the non-pooled one migrations use (port 5432); locally both are the same URL. Test files (`*.test.ts`) sit next to their subjects in `src/services/` and are excluded from the tsc build.

### Client (from `client/`)

```bash
npm start              # ng serve with proxy.conf.json → http://localhost:4200
npm run build          # production build
npm test               # vitest via ng test (runs once)
```

The dev proxy forwards `/api` and `/socket.io` (websocket) to `localhost:3000` — client code always uses relative `/api/...` URLs.

## Codebase Notes

- **Server layout**: `src/routes/` (auth, users, draft, chat + `cfbd.ts` whitelist proxy mounted last at `/api`), `src/services/` (pure, unit-tested scoring and snake-draft math — keep these free of I/O), `src/lib/` (prisma singleton, cfbd axios instance, socket.io holder), `prisma/` (schema + seed).
- **Scoring lives in `server/src/services/scoring.ts`** — `pointsForWin`, `classifyGame`, `pointsForGame`. Any rule change goes there and in its test file, nowhere else.
- **Draft is server-authoritative**: turn/exclusivity validated in `routes/draft.ts`; DB uniques on `[seasonYear, teamId]` and `[seasonYear, pickNumber]` are the final guard. Realtime events: `draft:pick` and `chat:message` via socket.io.
- **Client conventions**: Angular 21 zoneless with signals; pages in `src/app/pages/<name>/<name>.page.ts` lazy-loaded from `app.routes.ts`; shared session state in `src/app/core/` (AuthService signals, JWT interceptor, `CURRENT_SEASON` constant and models). Design tokens are CSS custom properties (`--mbl-*`) in `styles.scss` — use them, never raw hex, in component styles.
- **2026 is a fresh start (league owner's decision)**: v1's 2025 rosters and history are intentionally not imported — the seed creates only the 11 managers and season 2026. If 2025 data is ever wanted, v1's `user_teams.csv` (in the v1 repo) keys rosters by v1-database UUIDs, so a UUID→email mapping would have to be built first.
