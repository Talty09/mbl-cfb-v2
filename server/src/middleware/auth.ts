import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthPayload {
  sub: string; // user id
  displayName: string;
}

// Express request augmented with the authenticated user
export interface AuthedRequest extends Request {
  auth?: AuthPayload;
}

/**
 * Require a valid Bearer JWT. Read views are public; this guards write
 * actions (draft picks, chat posts) per the design handoff.
 */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    req.auth = jwt.verify(header.slice(7), config.jwtSecret) as AuthPayload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '30d' });
}
