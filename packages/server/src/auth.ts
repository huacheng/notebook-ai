import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// ── Token source ────────────────────────────────────────────────────────────
// NB_AUTH_TOKEN env var sets the shared secret. If unset, auth is disabled
// (open access — useful for local development).

const NB_AUTH_TOKEN = process.env['NB_AUTH_TOKEN'] ?? '';

/** Whether auth is enabled (non-empty NB_AUTH_TOKEN). */
export const authEnabled = NB_AUTH_TOKEN.length > 0;

// ── Brute-force protection ──────────────────────────────────────────────────

interface FailRecord {
  count: number;
  lockedUntil: number; // epoch ms
}

const failMap = new Map<string, FailRecord>();

/** Base lockout in ms after first failure. Doubles each subsequent failure. */
const BASE_LOCKOUT_MS = 60_000;
/** Max lockout cap: 30 minutes. */
const MAX_LOCKOUT_MS = 30 * 60_000;

function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

function checkRateLimit(ip: string): { blocked: boolean; retryAfterSec: number } {
  const rec = failMap.get(ip);
  if (!rec || rec.count === 0) return { blocked: false, retryAfterSec: 0 };
  const now = Date.now();
  if (now < rec.lockedUntil) {
    return { blocked: true, retryAfterSec: Math.ceil((rec.lockedUntil - now) / 1000) };
  }
  // Lockout expired — allow attempt but keep count (never resets until success)
  return { blocked: false, retryAfterSec: 0 };
}

function recordFailure(ip: string): number {
  const rec = failMap.get(ip) ?? { count: 0, lockedUntil: 0 };
  rec.count++;
  const lockout = Math.min(BASE_LOCKOUT_MS * Math.pow(2, rec.count - 1), MAX_LOCKOUT_MS);
  rec.lockedUntil = Date.now() + lockout;
  failMap.set(ip, rec);
  return Math.ceil(lockout / 1000);
}

function clearFailures(ip: string): void {
  failMap.delete(ip);
}

// Cleanup stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of failMap) {
    if (now > rec.lockedUntil + MAX_LOCKOUT_MS) failMap.delete(ip);
  }
}, 10 * 60_000);

// ── WS one-time ticket ──────────────────────────────────────────────────────

const TICKET_TTL_MS = 30_000; // 30 seconds

interface WsTicket {
  expiresAt: number;
}

const wsTickets = new Map<string, WsTicket>();

export function createWsTicket(): string {
  const ticket = crypto.randomUUID();
  wsTickets.set(ticket, { expiresAt: Date.now() + TICKET_TTL_MS });
  return ticket;
}

export function consumeWsTicket(ticket: string): boolean {
  const entry = wsTickets.get(ticket);
  if (!entry) return false;
  wsTickets.delete(ticket); // one-time use
  return Date.now() < entry.expiresAt;
}

// Cleanup expired tickets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [t, rec] of wsTickets) {
    if (now >= rec.expiresAt) wsTickets.delete(t);
  }
}, 5 * 60_000);

// ── Helpers ─────────────────────────────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  const len = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.concat([bufA, Buffer.alloc(len - bufA.length)]);
  const paddedB = Buffer.concat([bufB, Buffer.alloc(len - bufB.length)]);
  return crypto.timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}

// ── Login endpoint handler ──────────────────────────────────────────────────

export function handleLogin(req: Request, res: Response): void {
  if (!authEnabled) {
    res.json({ ok: true });
    return;
  }

  const ip = getClientIp(req);
  const { blocked, retryAfterSec } = checkRateLimit(ip);
  if (blocked) {
    res.status(429).json({ error: `Too many failed attempts. Try again in ${retryAfterSec}s.`, retryAfter: retryAfterSec });
    return;
  }

  const { token } = req.body as { token?: unknown };

  if (typeof token !== 'string' || !token) {
    const lockSec = recordFailure(ip);
    res.status(401).json({ error: `Token is required. Locked for ${lockSec}s.`, retryAfter: lockSec });
    return;
  }

  if (!timingSafeEqual(token, NB_AUTH_TOKEN)) {
    const lockSec = recordFailure(ip);
    res.status(401).json({ error: `Invalid token. Locked for ${lockSec}s.`, retryAfter: lockSec });
    return;
  }

  clearFailures(ip);
  res.json({ ok: true });
}

// ── Token verify endpoint (no rate limiting) ───────────────────────────────

export function handleVerify(req: Request, res: Response): void {
  if (!authEnabled) {
    res.json({ ok: true });
    return;
  }
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ ok: false });
    return;
  }
  const token = authHeader.slice(7);
  if (!timingSafeEqual(token, NB_AUTH_TOKEN)) {
    res.status(401).json({ ok: false });
    return;
  }
  res.json({ ok: true });
}

// ── WS ticket endpoint ─────────────────────────────────────────────────────

/**
 * POST /api/auth/ws-ticket — exchange a valid bearer token for a one-time WS ticket.
 * Manually validates the bearer token so it works regardless of middleware ordering.
 */
export function handleWsTicket(req: Request, res: Response): void {
  if (!authEnabled) {
    // No auth configured — return a ticket anyway (WS handler will skip check)
    res.json({ ticket: createWsTicket() });
    return;
  }
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization required.' });
    return;
  }
  const token = authHeader.slice(7);
  if (!timingSafeEqual(token, NB_AUTH_TOKEN)) {
    res.status(401).json({ error: 'Invalid token.' });
    return;
  }
  res.json({ ticket: createWsTicket() });
}

// ── Auth status endpoint ────────────────────────────────────────────────────

export function handleAuthStatus(_req: Request, res: Response): void {
  res.json({ authEnabled });
}

// ── Middleware ───────────────────────────────────────────────────────────────

/**
 * Express middleware that checks for a valid Bearer token on every request
 * except the auth endpoints themselves and health check.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Always allow auth endpoints and health check
  if (
    req.path === '/api/auth/login' ||
    req.path === '/api/auth/status' ||
    req.path === '/api/health'
  ) {
    next();
    return;
  }

  // If auth is not configured, allow all requests
  if (!authEnabled) {
    next();
    return;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization required.' });
    return;
  }

  const token = authHeader.slice(7);
  if (!timingSafeEqual(token, NB_AUTH_TOKEN)) {
    res.status(401).json({ error: 'Invalid token.' });
    return;
  }

  next();
}
