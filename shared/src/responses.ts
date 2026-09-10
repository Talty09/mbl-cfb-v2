/**
 * Response shapes for `/api/*`.
 *
 * These are plain types rather than zod schemas: the Worker constructs them
 * from typed Drizzle queries (so they're checked at compile time) and the
 * client has no reason to re-validate its own backend at runtime.
 */

import type { DraftStatus, GameKind, SeasonType } from './domain';

/** The signed-in manager. Absent for guests, who get read-only access. */
export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  firstName: string;
  lastName: string;
  avatarHue: number;
  isCommissioner: boolean;
  /** True until the manager replaces their commissioner-issued one-time passphrase. */
  mustChangePassword: boolean;
}

/**
 * Who the caller is. `user` is null for guests rather than a 401, because
 * browsing unauthenticated is a supported state and the client shouldn't have to
 * treat the common case as an exception.
 */
export interface SessionResponse {
  user: SessionUser | null;
}

/** Minimal manager identity, embedded wherever a name and avatar are shown. */
export interface ManagerRef {
  id: string;
  displayName: string;
  avatarHue: number;
}

export interface Manager extends ManagerRef {
  username: string;
  isCommissioner: boolean;
  /** Season points to date. */
  points: number;
}

/**
 * Everything the app shell needs on load: header labels, draft status, and
 * ingest freshness. One request rather than four.
 */
export interface Meta {
  season: number;
  /** Current week per the CFBD calendar; null before the season opens. */
  currentWeek: number | null;
  seasonType: SeasonType;
  draftStatus: DraftStatus;
  /** Drives the header's pulsing LIVE pill. */
  hasGamesInProgress: boolean;
  /** Epoch ms of the last successful ingest slice, for "updated N min ago". */
  lastSyncAt: number | null;
  lastSyncError: string | null;
}

/**
 * Deliberately tiny change-detector. The client polls only this on a timer and
 * refetches a full resource when the matching counter moves — one request per
 * tick regardless of which view is open.
 */
export interface Pulse {
  /** Bumps on every pick; the Draft Room refetches when it changes. */
  pickCount: number;
  /** Max chat id; Trash Talk fetches `?since=` this value. */
  lastChatId: number;
  /** Bumps when the ingest writes anything; scoring views refetch. */
  lastSyncAt: number | null;
  currentWeek: number | null;
  draftStatus: DraftStatus;
  /** Sessions seen in the last two minutes, for the chat header's green dot. */
  onlineCount: number;
}

/** A team in the draft pool or on a roster. */
export interface TeamOption {
  id: number;
  school: string;
  mascot: string | null;
  conference: string | null;
  /** AP rank for the current week, if ranked. */
  rank: number | null;
  wins: number;
  losses: number;
  /** Null when undrafted. */
  ownedBy: ManagerRef | null;
}

export interface DraftPickView {
  pickNumber: number;
  round: number;
  team: { id: number; school: string };
  user: ManagerRef;
  /** Set when the commissioner picked on this manager's behalf. */
  madeByCommissioner: boolean;
  createdAt: number;
}

/**
 * Server-authoritative draft state. There is no clock: `onClockSince` is how
 * long the current manager has been up, shown as "since 2h ago" where the
 * design handoff had a 90-second countdown.
 */
export interface DraftState {
  season: number;
  draftStatus: DraftStatus;
  rounds: number;
  managerCount: number;
  /** Slot order, index 0 = slot 1. */
  order: ManagerRef[];
  picks: DraftPickView[];
  /** Null once the draft is complete. */
  nextPickNumber: number | null;
  currentRound: number | null;
  onClockUser: ManagerRef | null;
  /** Epoch ms the previous pick landed, i.e. when the current manager went up. */
  onClockSince: number | null;
}

/** One team's side of a scoreboard card. */
export interface ScoreboardTeam {
  teamId: number | null;
  school: string;
  rank: number | null;
  wins: number;
  losses: number;
  points: number | null;
  owner: ManagerRef | null;
}

export interface ScoreboardGame {
  id: number;
  startDate: number | null;
  completed: boolean;
  kind: GameKind;
  notes: string | null;
  home: ScoreboardTeam;
  away: ScoreboardTeam;
  /** Fantasy points earned on this game, and by whom. Null if nobody owned the winner. */
  fantasy: {
    user: ManagerRef;
    points: number;
    kind: GameKind;
    beatTop25: boolean;
  } | null;
}

export interface ScoreboardResponse {
  season: number;
  week: number;
  seasonType: SeasonType;
  games: ScoreboardGame[];
  /** Top scorer of the week, for the Baller of the Week banner. */
  ballerOfTheWeek: { user: ManagerRef; points: number } | null;
}

export interface StandingsRow {
  rank: number;
  user: ManagerRef;
  /** Points earned in the current week. */
  weekPoints: number;
  /** Count of 2-point regular-season Top-25 wins, per the design's RANKED column. */
  rankedWins: number;
  total: number;
}

export interface StandingsResponse {
  season: number;
  currentWeek: number | null;
  rows: StandingsRow[];
  /** Per-manager weekly totals, powering Past Scores and the Rivalry Watch chart. */
  weekly: { week: number; points: Record<string, number> }[];
}

export interface WeekScoresRow {
  rank: number;
  user: ManagerRef;
  weekPoints: number;
  seasonTotal: number;
}

export interface WeekScoresResponse {
  season: number;
  week: number;
  rows: WeekScoresRow[];
}

/** One Locker Room card: a manager and their 10 teams. */
export interface RosterCard {
  user: ManagerRef;
  total: number;
  teams: (TeamOption & { points: number })[];
}

export interface ChatMessageView {
  id: number;
  body: string;
  createdAt: number;
  user: ManagerRef;
}

export interface ChatResponse {
  messages: ChatMessageView[];
  onlineCount: number;
}

/** Uniform error body for every non-2xx response. */
export interface ApiError {
  error: string;
}
