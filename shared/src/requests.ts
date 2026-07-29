/**
 * Request bodies, defined once and validated on both sides — the client can
 * reject bad input before a round trip, and the Worker never trusts it.
 *
 * Written against zod 4: use `{ error: ... }` rather than v3's
 * `required_error`/`invalid_type_error`.
 */

import { z } from 'zod';
import { DRAFT_ROUNDS } from './domain';

/** Usernames are stored lowercased; normalize on the way in so login is case-insensitive. */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9._-]+$/, {
    error: 'Username may contain only letters, numbers, dots, hyphens and underscores',
  });

export const loginRequestSchema = z.object({
  username: usernameSchema,
  /**
   * Generous ceiling, low floor: the commissioner hands out generated 4-word
   * passphrases, so the practical minimum is far above 1 — but rejecting a
   * short password here would only leak which accounts exist.
   */
  password: z.string().min(1).max(512),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const chatPostRequestSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
export type ChatPostRequest = z.infer<typeof chatPostRequestSchema>;

export const draftPickRequestSchema = z.object({
  /** CFBD team id. Must be an undrafted FBS team. */
  teamId: z.number().int().positive(),
});
export type DraftPickRequest = z.infer<typeof draftPickRequestSchema>;

/** Commissioner-only: pick on an unreachable manager's behalf. */
export const draftPickForRequestSchema = draftPickRequestSchema.extend({
  userId: z.string().min(1),
});
export type DraftPickForRequest = z.infer<typeof draftPickForRequestSchema>;

/** Commissioner-only: open or close the draft. */
export const draftStatusRequestSchema = z.object({
  draftStatus: z.enum(['pending', 'active', 'complete']),
});
export type DraftStatusRequest = z.infer<typeof draftStatusRequestSchema>;

/**
 * Commissioner-only: set the draft order. The array is the order itself —
 * index 0 is slot 1 — so slots can never be sparse or duplicated.
 */
export const draftOrderRequestSchema = z.object({
  userIds: z
    .array(z.string().min(1))
    .min(2)
    .max(32)
    .refine((ids) => new Set(ids).size === ids.length, {
      error: 'A manager cannot appear twice in the draft order',
    }),
});
export type DraftOrderRequest = z.infer<typeof draftOrderRequestSchema>;

/** Commissioner-only: force an ingest slice instead of waiting for cron. */
export const adminSyncRequestSchema = z.object({
  /** Omit to advance whatever slice the cursor points at. */
  slice: z.enum(['teams', 'calendar', 'games', 'rankings', 'points']).optional(),
  season: z.number().int().min(2000).max(2100).optional(),
  week: z.number().int().min(1).max(20).optional(),
  seasonType: z.enum(['regular', 'postseason']).optional(),
});
export type AdminSyncRequest = z.infer<typeof adminSyncRequestSchema>;

/** Guard used by both sides when validating a completed draft. */
export function totalPicksFor(managerCount: number): number {
  return DRAFT_ROUNDS * managerCount;
}
