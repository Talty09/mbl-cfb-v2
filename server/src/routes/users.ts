import { Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

/**
 * Public league roster data: managers and the teams they own per season.
 * Never exposes emails or password hashes.
 */
router.get('/', async (req, res) => {
  const seasonYear = req.query.season ? parseInt(req.query.season as string, 10) : undefined;

  const users = await prisma.user.findMany({
    select: {
      id: true,
      displayName: true,
      avatarHue: true,
      rosterSpots: {
        where: seasonYear ? { seasonYear } : undefined,
        select: { seasonYear: true, teamId: true },
      },
    },
    orderBy: { displayName: 'asc' },
  });

  res.json(users);
});

export default router;
