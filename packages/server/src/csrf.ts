import type { Request, Response, NextFunction } from 'express';
import { COOKIE_NAME } from './auth-helpers.js';

const DEFAULT_ORIGINS = 'http://localhost:3003,http://localhost:4003';

function allowedOrigins(): string[] {
  return (process.env['NB_ALLOWED_ORIGINS'] ?? DEFAULT_ORIGINS)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env['NB_CSRF_DISABLED'] === '1') { next(); return; }
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  // CSRF protection: only check Origin for requests with auth cookies.
  // Bearer-token clients (curl, NB_AUTH_TOKEN automation) bypass — they
  // have a different CSRF profile (manual header, no browser-driven origin).
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (!cookies?.[COOKIE_NAME]) { next(); return; }

  const origin = (req.headers.origin as string | undefined)
    ?? (req.headers.referer as string | undefined);
  if (!origin) { res.status(403).json({ error: 'Origin required.' }); return; }

  let originValue: string;
  try {
    originValue = new URL(origin).origin;
  } catch {
    res.status(403).json({ error: 'Forbidden origin.' });
    return;
  }
  const allowed = allowedOrigins().some(o => {
    try { return new URL(o).origin === originValue; } catch { return false; }
  });
  if (!allowed) { res.status(403).json({ error: 'Forbidden origin.' }); return; }
  next();
}
