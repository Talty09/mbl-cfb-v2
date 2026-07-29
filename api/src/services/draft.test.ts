import { describe, expect, it } from 'vitest';
import { isDraftComplete, roundForPick, slotForPick, totalPicks } from './draft';

describe('snake draft order (11 managers)', () => {
  const N = 11;

  it('round 1 goes slot 1 through 11 in order', () => {
    expect(slotForPick(1, N)).toBe(1);
    expect(slotForPick(11, N)).toBe(11);
  });

  it('round 2 snakes back: slot 11 picks twice in a row', () => {
    expect(slotForPick(12, N)).toBe(11);
    expect(slotForPick(13, N)).toBe(10);
    expect(slotForPick(22, N)).toBe(1);
  });

  it('round 3 goes forward again: slot 1 picks twice in a row', () => {
    expect(slotForPick(23, N)).toBe(1);
  });

  it('derives rounds and completion', () => {
    expect(roundForPick(1, N)).toBe(1);
    expect(roundForPick(12, N)).toBe(2);
    expect(roundForPick(110, N)).toBe(10);
    expect(totalPicks(N)).toBe(110);
    expect(isDraftComplete(109, N)).toBe(false);
    expect(isDraftComplete(110, N)).toBe(true);
  });
});
