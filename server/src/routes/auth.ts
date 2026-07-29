import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { AuthedRequest, requireAuth, signToken } from '../middleware/auth';

const router = Router();

const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  avatarHue: true,
  isCommissioner: true,
} as const;

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const token = signToken({ sub: user.id, displayName: user.displayName });
  const { passwordHash: _hash, ...publicUser } = user;
  res.json({ token, user: publicUser });
});

router.get('/me', requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.sub },
    select: PUBLIC_USER_SELECT,
  });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(user);
});

export default router;
