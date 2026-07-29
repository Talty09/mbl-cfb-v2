/** The season the app is currently operating on. */
export const CURRENT_SEASON = 2026;

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  avatarHue: number;
  isCommissioner: boolean;
}

export interface Manager {
  id: string;
  displayName: string;
  avatarHue: number;
  rosterSpots: { seasonYear: number; teamId: number }[];
}

export interface ChatMessage {
  id: string;
  seasonYear: number;
  body: string;
  createdAt: string;
  user: { id: string; displayName: string; avatarHue: number };
}

export interface DraftState {
  season: {
    year: number;
    draftStatus: 'PENDING' | 'ACTIVE' | 'COMPLETE';
    pickClockSeconds: number;
    currentPickStartedAt: string | null;
  };
  slots: { slot: number; user: { id: string; displayName: string; avatarHue: number } }[];
  picks: {
    pickNumber: number;
    teamId: number;
    teamName: string;
    user: { id: string; displayName: string };
  }[];
  managerCount: number;
  nextPickNumber: number | null;
  currentRound: number | null;
  onClockUser: { id: string; displayName: string; avatarHue: number } | null;
}

/** oklch avatar color per the design handoff. */
export function avatarColor(hue: number): string {
  return `oklch(0.78 0.14 ${hue})`;
}

export function initials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
