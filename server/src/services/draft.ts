/**
 * Snake draft mechanics, kept pure for testability.
 * Slots are 1-based positions in the draft order. Odd rounds go slot 1..N,
 * even rounds go N..1. pickNumber is the 1-based overall pick.
 */

export const DRAFT_ROUNDS = 10;

/** Which slot (1..managerCount) is on the clock for a given overall pick. */
export function slotForPick(pickNumber: number, managerCount: number): number {
  const round = Math.ceil(pickNumber / managerCount);
  const indexInRound = (pickNumber - 1) % managerCount; // 0-based
  return round % 2 === 1 ? indexInRound + 1 : managerCount - indexInRound;
}

export function roundForPick(pickNumber: number, managerCount: number): number {
  return Math.ceil(pickNumber / managerCount);
}

export function totalPicks(managerCount: number): number {
  return DRAFT_ROUNDS * managerCount;
}

export function isDraftComplete(picksMade: number, managerCount: number): boolean {
  return picksMade >= totalPicks(managerCount);
}
