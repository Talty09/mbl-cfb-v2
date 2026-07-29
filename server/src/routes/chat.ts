import { Router } from 'express';
import { getIo } from '../lib/realtime';
import { prisma } from '../lib/prisma';
import { AuthedRequest, requireAuth } from '../middleware/auth';

const router = Router();

const AUTHOR_SELECT = { select: { id: true, displayName: true, avatarHue: true } };
const MAX_BODY_LENGTH = 1000;

router.get('/:year', async (req, res) => {
  const seasonYear = parseInt(String(req.params.year), 10);
  const messages = await prisma.chatMessage.findMany({
    where: { seasonYear },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { user: AUTHOR_SELECT },
  });
  res.json(messages.reverse());
});

router.post('/:year', requireAuth, async (req: AuthedRequest, res) => {
  const seasonYear = parseInt(String(req.params.year), 10);
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) {
    res.status(400).json({ error: 'Message body is required' });
    return;
  }

  const message = await prisma.chatMessage.create({
    data: { seasonYear, userId: req.auth!.sub, body: body.slice(0, MAX_BODY_LENGTH) },
    include: { user: AUTHOR_SELECT },
  });

  getIo().emit('chat:message', message);
  res.status(201).json(message);
});

export default router;
