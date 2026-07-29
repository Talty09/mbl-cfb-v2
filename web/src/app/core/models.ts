/**
 * Client-side view models.
 *
 * Types and helpers both sides need now live in the `shared` workspace and are
 * re-exported here, so pages keep importing from `core/models` while there is
 * only one definition of each.
 */

export { avatarColor, initials } from 'shared';
export type { SessionResponse, SessionUser } from 'shared';

/** The season the app is currently operating on. */
export const CURRENT_SEASON = 2026;

/**
 * TODO(phase 5): replace with `RosterCard` from `shared`. `rosterSpots` names a
 * table that no longer exists — ownership is derived from picks now — so this
 * survives only until the Locker Room view is wired to the real endpoint.
 */
export interface Manager {
  id: string;
  displayName: string;
  avatarHue: number;
  rosterSpots: { seasonYear: number; teamId: number }[];
}

/** TODO(phase 6): replace with `ChatMessageView` from `shared`. */
export interface ChatMessage {
  id: string;
  seasonYear: number;
  body: string;
  createdAt: string;
  user: { id: string; displayName: string; avatarHue: number };
}
