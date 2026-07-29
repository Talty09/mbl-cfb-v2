import { Request, Response, Router } from 'express';
import { cfbdApi } from '../lib/cfbd';

const router = Router();

/**
 * Whitelisted proxy to the College Football Data API. Same pattern as v1:
 * receive request → forward with our API key → return response. The client
 * never sees the key. Add paths here as views need them.
 */
const ALLOWED_PATHS = [
  '/games',
  '/games/teams',
  '/teams',
  '/teams/fbs',
  '/rankings',
  '/calendar',
  '/scoreboard',
  '/records',
];

for (const path of ALLOWED_PATHS) {
  router.get(path, async (req: Request, res: Response) => {
    try {
      const response = await cfbdApi.get(path, { params: req.query });
      res.json(response.data);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status ?? 502;
      res.status(status).json({ error: `CFBD request failed for ${path}` });
    }
  });
}

export default router;
