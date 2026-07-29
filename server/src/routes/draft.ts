import { Router } from 'express';
import { getIo } from '../lib/realtime';
import { prisma } from '../lib/prisma';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { isDraftComplete, roundForPick, slotForPick } from '../services/draft';

const router = Router();

async function getDraftState(seasonYear: number) {
  const [season, slots, picks] = await Promise.all([
    prisma.season.findUnique({ where: { year: seasonYear } }),
    prisma.draftSlot.findMany({
      where: { seasonYear },
      orderBy: { slot: 'asc' },
      include: { user: { select: { id: true, displayName: true, avatarHue: true } } },
    }),
    prisma.draftPick.findMany({
      where: { seasonYear },
      orderBy: { pickNumber: 'asc' },
      include: { user: { select: { id: true, displayName: true } } },
    }),
  ]);

  if (!season) return null;

  const managerCount = slots.length;
  const nextPickNumber = picks.length + 1;
  const complete = managerCount > 0 && isDraftComplete(picks.length, managerCount);
  const onClockSlot = complete || managerCount === 0 ? null : slotForPick(nextPickNumber, managerCount);
  const onClockUser = onClockSlot ? slots[onClockSlot - 1]?.user ?? null : null;

  return {
    season: {
      year: season.year,
      draftStatus: complete ? 'COMPLETE' : season.draftStatus,
      pickClockSeconds: season.pickClockSeconds,
      currentPickStartedAt: season.currentPickStartedAt,
    },
    slots,
    picks,
    managerCount,
    nextPickNumber: complete ? null : nextPickNumber,
    currentRound: complete || managerCount === 0 ? null : roundForPick(nextPickNumber, managerCount),
    onClockUser,
  };
}

router.get('/:year', async (req, res) => {
  const year = parseInt(String(req.params.year), 10);
  const state = await getDraftState(year);
  if (!state) {
    res.status(404).json({ error: `No season ${req.params.year}` });
    return;
  }
  res.json(state);
});

/**
 * Make a pick. Server-authoritative: validates draft is active, it's the
 * caller's turn, and the team is not already owned this season.
 * TODO: auto-pick on clock expiry (needs a server-side timer or a
 * commissioner "force pick" action).
 */
router.post('/:year/pick', requireAuth, async (req: AuthedRequest, res) => {
  const year = parseInt(String(req.params.year), 10);
  const { teamId, teamName } = req.body ?? {};
  if (!Number.isInteger(teamId) || typeof teamName !== 'string' || !teamName.trim()) {
    res.status(400).json({ error: 'teamId (number) and teamName (string) are required' });
    return;
  }

  const state = await getDraftState(year);
  if (!state) {
    res.status(404).json({ error: `No season ${year}` });
    return;
  }
  if (state.season.draftStatus !== 'ACTIVE') {
    res.status(409).json({ error: `Draft is ${state.season.draftStatus.toLowerCase()}` });
    return;
  }
  if (!state.onClockUser || state.onClockUser.id !== req.auth!.sub) {
    res.status(403).json({ error: 'Not your pick' });
    return;
  }

  try {
    // Pick + roster spot + clock reset in one transaction. The DB uniques on
    // [seasonYear, teamId] and [seasonYear, pickNumber] are the real guard
    // against double-drafts and race conditions.
    await prisma.$transaction([
      prisma.draftPick.create({
        data: {
          seasonYear: year,
          pickNumber: state.nextPickNumber!,
          userId: req.auth!.sub,
          teamId,
          teamName: teamName.trim(),
        },
      }),
      prisma.rosterSpot.create({
        data: { seasonYear: year, userId: req.auth!.sub, teamId },
      }),
      prisma.season.update({
        where: { year },
        data: { currentPickStartedAt: new Date() },
      }),
    ]);
  } catch {
    res.status(409).json({ error: 'Team already drafted or pick number taken — refresh draft state' });
    return;
  }

  const newState = await getDraftState(year);
  if (newState && newState.nextPickNumber === null) {
    await prisma.season.update({
      where: { year },
      data: { draftStatus: 'COMPLETE', currentPickStartedAt: null },
    });
    newState.season.draftStatus = 'COMPLETE';
  }

  getIo().emit('draft:pick', newState);
  res.status(201).json(newState);
});

export default router;
