import type { Request } from 'express';
import { sessionCache } from './auth.js';
import type { SessionToken } from './session-cache.js';

export const COOKIE_NAME = 'nb-auth-token';

export function extractToken(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const cookie = cookies?.[COOKIE_NAME];
  if (cookie) return cookie;
  const h = req.headers['authorization'];
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

export type AuthResult =
  | { ok: true; session: SessionToken; token: string }
  | { ok: false; error: string; status: number };

export function requireAuth(req: Request): AuthResult {
  const token = extractToken(req);
  if (!token) return { ok: false, error: 'Authorization required.', status: 401 };
  const session = sessionCache.validate(token);
  if (!session) return { ok: false, error: 'Invalid or expired token.', status: 401 };
  return { ok: true, session, token };
}
