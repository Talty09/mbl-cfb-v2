# Handoff: Most Baller League — Fantasy College Football Site

## Overview
Most Baller League (MBL) is a fantasy college football web app. Each manager drafts 10 real FBS teams in a live snake draft, then earns points as those teams win games during the season (**1 pt per win, 2 pts for beating an AP Top 25 opponent**). The app surfaces a live-style scoreboard, season standings, past scores by week, manager rosters, a live draft room, and a group-chat "trash talk" forum. Managers sign in to draft and to post in chat.

This handoff covers a single-screen app with six main views plus a login gate and a live draft room.

## About the Design Files
The file in this bundle (`Most Baller League.dc.html`) is a **design reference created in HTML** — a prototype showing intended look and behavior, **not production code to copy directly**. It is authored in a proprietary "Design Component" runtime (`<x-dc>` template + a `DCLogic` class) that will not exist in your codebase. **Do not port that runtime.**

Your task is to **recreate this design in the target codebase's environment.** The referenced source repos are Angular (client) + Node/Express + Prisma/PostgreSQL (server) consuming the College Football Data API (https://api.collegefootballdata.com). Recreate these views as Angular standalone components (or whatever the current stack is), using the existing `CfbdApiService`, routing, and styling patterns. All data shown in the mock is hardcoded placeholder data — replace it with real API/DB data.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, and interactions are intended to be matched closely. Recreate the UI faithfully using your framework's components and your design system where one exists. Exact tokens are listed under **Design Tokens** below.

## Screens / Views

The app is one page with a sticky top nav switching between views. A login gate precedes everything (skippable in the mock via a "Browse without signing in" button / a `requireLogin` flag — in production, gate write actions, not read views).

### 0. Login
- **Purpose**: Manager signs in with email + password before drafting or chatting.
- **Layout**: Centered card, max-width 400px, on the page background. Logo tile, title, email field, password field, error line (conditional), primary "SIGN IN" button, secondary "BROWSE WITHOUT SIGNING IN" outline button, "Forgot password?" link, and a demo hint box.
- **Components**:
  - Logo tile: 56×56, bg `#F2B322`, text `#07080B`, "MB", Barlow Condensed 800 / 30px, radius 8px.
  - Title "SIGN IN TO THE LEAGUE": Barlow Condensed 800, 26px, letter-spacing 2px.
  - Inputs: bg `#0E1117`, border `1px solid #232937`, radius 8px, padding 12px 14px, text `#EDEFF4`; focus border `#F2B322`. Labels 11px, letter-spacing 2px, `#8B93A6`, weight 600.
  - Primary button: bg `#F2B322`, text `#07080B`, Barlow Condensed 800 / 18px, radius 8px, padding 13px; hover bg `#FFCB4D`.
- **Behavior (mock)**: Email prefix matching a manager name (e.g. `chris@…`) signs you in as that manager; any other email → guest. Real impl: proper auth (email + password) against the users table.

### 1. Scoreboard (default view)
- **Purpose**: This week's games with fantasy point attribution.
- **Layout**: Optional "Baller of the Week" banner, section heading, then a responsive grid of game cards (`repeat(auto-fill, minmax(330px, 1fr))`, gap 14px).
- **Game card**: bg `#12151C`, border `1px solid #232937`, radius 10px, padding 14px 16px. Top row: status/clock (live = `#FF6B6B`, pulsing; final = `#B9C0D0`; upcoming = `#8B93A6`) and an optional point-note pill (ranked win / +2 highlighted gold). Two team rows each: AP rank (gold), team name (Barlow Condensed 700 / 20px; leader `#EDEFF4`, loser `#8B93A6`), record, owner chip (avatar dot + manager name), score (Barlow Condensed 800 / 26px, right-aligned).
- **Baller of the Week banner**: gradient `linear-gradient(105deg,#1A1608,#12151C 55%)`, border `#3D3113`, radius 10px. Avatar, label "BALLER OF THE WEEK", manager name (Barlow Condensed 800 / 30px), blurb, big point number in gold.

### 2. Standings
- **Purpose**: Season leaderboard through current week + a rivalry panel.
- **Layout**: 2-col grid `minmax(0,2fr) minmax(280px,1fr)`, gap 20px, align-items start.
- **Standings table**: column grid `44px minmax(0,1fr) 60px 60px 90px` = Rank / Manager / Wk / Ranked-Wins / Total. Header row 11px labels `#8B93A6`. Rows separated by `1px solid #1A1F2A`; leader row tinted `rgba(242,179,34,0.06)`, rank number gold. Manager cell: 28px avatar circle + name. Total in Barlow Condensed 800 / 22px.
- **Rivalry panel**: card. "RIVALRY WATCH" label `#FF6B6B`, matchup title, per-week mirrored bar chart (two managers' weekly points, left/right of a center week label), season totals footer.

### 3. Past Scores (Weeks)
- **Purpose**: Per-week results, selectable by week.
- **Layout**: Heading + a row of week chips (WK 1…8). Selected chip: bg `#F2B322`, text `#07080B`; unselected: bg `#12151C`, border `#232937`, text `#B9C0D0`. Then a table: `44px minmax(0,1fr) minmax(120px,2fr) 70px 90px` = Rank / Manager / week-score bar / Pts / Season. Rows re-sort by that week's points; leader bar gold, others `#39415a`.

### 4. Locker Room (Rosters)
- **Purpose**: Each manager's 10 drafted teams.
- **Layout**: card grid `repeat(auto-fill, minmax(330px,1fr))`, gap 14px. Card header: avatar + manager name (Barlow Condensed 800 / 20px) + season total in gold. Body: wrapping team chips (bg `#171B24`, border `#232937`, radius 6px), each with optional AP rank (gold), team name, record (`#8B93A6`).

### 5. Draft Room
- **Purpose**: Live snake draft, 10 rounds, teams exclusive (one owner per team).
- **Layout**: Header row — left: "LIVE DRAFT · SNAKE FORMAT" label + "ROUND n OF 10 · PICK n" title; right: on-the-clock card (avatar, manager name, countdown timer). If it's the signed-in user's turn, a gold banner spans below. Main body: 2 flexible columns.
  - **Pick board** (flex 2 1 480px, horizontally scrollable, min-width 860px): grid `40px repeat(11, minmax(70px,1fr))` — row label + one column per manager (11 managers). Header row = manager avatars. 10 body rows (R1…R10). Snake order: even rounds L→R, odd rounds R→L. Filled cells: bg `#171B24`, border `#232937`, team name. Current pick cell: gold border, "ON CLOCK". Empty future cells: dashed `#1A1F2A`.
  - **Available teams panel** (flex 1 1 280px): header "AVAILABLE TEAMS (count)" + search input; scrollable list (max-height 460px) of undrafted teams sorted by AP rank then name. Each row: rank, name, record, "DRAFT" button. Button active (gold) only on the user's turn; otherwise disabled-looking (`#171B24`/`#4A5163`).
- **Timer**: Barlow Condensed 800 / 30px; ≤15s turns `#FF6B6B` and pulses; counts down 1/sec while the draft view is active; resets to 90s on a pick.

### 6. Trash Talk (Chat)
- **Purpose**: League group chat.
- **Layout**: Centered column, max-width 760px, card, height `calc(100vh - 260px)` (min 480px), flex column. Header: "THE TRASH TALK" + "11 ballers · no refs" + online count (`#3DD68C` dot). Scrollable message list (gap 14px). Each message: 32px avatar + name + timestamp + bubble (bg `#171B24`, border `#232937`, radius `4px 12px 12px 12px`, padding 8px 12px). Composer at bottom: text input + gold "SEND" button; Enter also sends. Posts appear under the signed-in manager's name/color.

## Shared Chrome
- **Header**: bg `#07080B`, bottom border `#232937`. Logo tile "MB" + wordmark "MOST BALLER LEAGUE" (Barlow Condensed 800 / 26px, letter-spacing 2px) + subtitle. Right side: pulsing "LIVE" pill, "WEEK 9 · 2026" label, and (when signed in) a user chip with avatar, name, and "SIGN OUT".
- **Ticker** (optional): dark strip under header, horizontally scrolling score lines, CSS `@keyframes` translateX 0→-50% over 40s, doubled content for seamless loop.
- **Nav**: sticky (top:0), horizontal tab bar. Active tab: text `#F2B322`, 3px gold bottom-border. Tabs: SCOREBOARD, STANDINGS, PAST SCORES, LOCKER ROOM, DRAFT ROOM, TRASH TALK.
- **Footer**: top border, centered muted caption.

## Interactions & Behavior
- Tab click → switch view (client-side route in production).
- Login: validate email contains "@" and password non-empty → set current user. "Browse without signing in" → guest session.
- Draft: click DRAFT (only enabled on your turn) → append pick to board, advance snake order, reset 90s clock. Timer ticks each second while draft view is active; ≤15s = red pulse.
- Week chips → re-sort/refilter past-scores table.
- Chat: type + SEND or Enter → append message under current user.
- Live game cards: status pill pulses for in-progress games.

## State Management
- `user` — current signed-in manager (or guest / null).
- `activeTab` — current view.
- `selectedWeek` — for Past Scores.
- `draftPicks` — ordered list of picks (manager → team); derives round, pick number, on-the-clock manager (snake), and drafted-set for filtering the pool.
- `draftClock` — countdown seconds, reset on pick.
- `chatMessages` — appended list; `chatDraft` — composer text.
- Real data fetching: teams/games/rankings/records from CFBD API via existing service; users, user_teams, draft picks, and chat messages from the backend/DB.

## Design Tokens
**Colors**
- Background (app): `#0B0D11`
- Background (header/deepest): `#07080B`
- Surface (cards): `#12151C`
- Surface (inputs/wells): `#0E1117`
- Surface (chips/inner): `#171B24`
- Border: `#232937`; subtle row divider: `#1A1F2A`; hover border: `#39415a`
- Text primary: `#EDEFF4`; secondary: `#D6DAE4` / `#B9C0D0`; muted: `#8B93A6`; disabled: `#4A5163`
- Accent (brand gold): `#F2B322`; hover: `#FFCB4D`; gold-on-dark tint: `rgba(242,179,34,0.06–0.14)`
- Live/alert red: `#FF4D4D` / `#FF6B6B`; online green: `#3DD68C`
- Baller banner gradient: `linear-gradient(105deg,#1A1608 0%,#12151C 55%)`, border `#3D3113`
- Manager avatar colors: generated per manager as `oklch(0.78 0.14 <hue>)` — assign a distinct hue per manager; text on avatar is `#07080B`.

**Typography**
- Display/UI headings & numbers: **Barlow Condensed** (500–800). Body/labels: **Barlow** (400–700). (Google Fonts.)
- Common sizes: wordmark 26px/800; section headings 22–26px/800 ls 2px; game team name 20px/700; scores 26px/800; big stat numbers 30–44px/800; body 13–15px; labels 11px ls 1.5–3px.

**Radius**: 6px (chips), 8px (inputs/buttons), 10px (cards), 12px (login card), 999px (pills).

**Spacing**: card padding 14–18px; grid gaps 4px (draft board), 14px (card grids), 20px (major columns); page container max-width 1200px, padding 24px 20px 60px.

**Motion**: `mblPulse` (opacity 1→.35→1, 1–1.6s) for live/urgent; ticker translateX over 40s linear; timer pulse 1s when urgent.

## Assets
No external images. All avatars are colored circles with initials; the logo is a text tile ("MB"). Team logos are **not** used in the mock — if you add real CFBD team logos, source them from the API's team endpoints. Fonts load from Google Fonts (Barlow, Barlow Condensed).

## Screenshots
Reference captures of every view are in `screenshots/`:
- `0-login.png` — Login gate
- `1-scoreboard.png` — Scoreboard + Baller of the Week
- `2-standings.png` — Standings + Rivalry Watch
- `3-past-scores.png` — Past Scores (week selector)
- `4-locker-room.png` — Locker Room (rosters)
- `5-draft-room.png` — Live snake Draft Room (user on the clock)
- `6-trash-talk.png` — Trash Talk chat

## Files
- `Most Baller League.dc.html` — the full design prototype (all six views + login + draft room). Open in a browser to view. Treat as visual/behavioral reference only; the `<x-dc>` template and `DCLogic` JS are runtime-specific and should be re-implemented in your framework.
