import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { NotebookDb } from './db.js';

// ── Configuration ────────────────────────────────────────────────────────────

const TRUST_PROXY = !!process.env['TRUST_PROXY'];

/**
 * Auth is enabled unless NB_AUTH_DISABLED=1 (for testing only).
 * In production, always leave this unset.
 */
export const authEnabled = process.env['NB_AUTH_DISABLED'] !== '1';

// ── Brute-force protection ──────────────────────────────────────────────────

interface FailRecord {
  count: number;
  lockedUntil: number; // epoch ms
}

const failMap = new Map<string, FailRecord>();

/** Base lockout in ms after first failure. Doubles each subsequent failure. */
export const BASE_LOCKOUT_MS = 60_000;
/** Base lockout in seconds (for display/sharing with frontend). */
export const BASE_LOCKOUT_SEC = BASE_LOCKOUT_MS / 1000;
/** Max lockout cap: 30 minutes. */
export const MAX_LOCKOUT_MS = 30 * 60_000;

export function getClientIp(req: Request): string {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') return xff.split(',')[0].trim();
  }
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

// ── Session token management ─────────────────────────────────────────────────

const SESSION_TOKEN_TTL_MS = 7 * 24 * 60 * 60_000; // 7 days

interface SessionToken {
  userId: string;
  email: string;
  expiresAt: number;
}

const sessionTokens = new Map<string, SessionToken>();

export function createSessionToken(userId: string, email: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  sessionTokens.set(token, {
    userId,
    email,
    expiresAt: Date.now() + SESSION_TOKEN_TTL_MS,
  });
  return token;
}

export function validateSessionToken(token: string): SessionToken | null {
  const session = sessionTokens.get(token);
  if (!session) return null;
  if (Date.now() >= session.expiresAt) {
    sessionTokens.delete(token);
    return null;
  }
  return session;
}

export function revokeSessionToken(token: string): void {
  sessionTokens.delete(token);
}

// Cleanup expired sessions every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessionTokens) {
    if (now >= session.expiresAt) sessionTokens.delete(token);
  }
}, 30 * 60_000);

// ── WS one-time ticket ──────────────────────────────────────────────────────

const TICKET_TTL_MS = 30_000; // 30 seconds

interface WsTicket {
  expiresAt: number;
  userId: string;
}

const wsTickets = new Map<string, WsTicket>();

export function createWsTicket(userId: string): string {
  const ticket = crypto.randomUUID();
  wsTickets.set(ticket, { expiresAt: Date.now() + TICKET_TTL_MS, userId });
  return ticket;
}

export function consumeWsTicket(ticket: string): { valid: boolean; userId?: string } {
  const entry = wsTickets.get(ticket);
  if (!entry) return { valid: false };
  wsTickets.delete(ticket); // one-time use
  if (Date.now() >= entry.expiresAt) return { valid: false };
  return { valid: true, userId: entry.userId };
}

// Cleanup expired tickets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [t, rec] of wsTickets) {
    if (now >= rec.expiresAt) wsTickets.delete(t);
  }
}, 5 * 60_000);

// ── Password hashing (scrypt) ─────────────────────────────────────────────────

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // N
const SCRYPT_BLOCK_SIZE = 8; // r
const SCRYPT_PARALLEL = 1; // p

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLEL }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) { resolve(false); return; }
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLEL }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derivedKey));
    });
  });
}

// ── Email validation ─────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email) && email.length <= 254;
}

// ── Database access ──────────────────────────────────────────────────────────

// Lazy singleton to avoid creating db connection until needed
let _db: NotebookDb | null = null;
function getDb(): NotebookDb {
  if (!_db) {
    _db = new NotebookDb();
  }
  return _db;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  status: string;
  created_at: string;
}

interface InviteCodeRow {
  code: string;
  max_uses: number;
  used_count: number;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
}

// ── Registration with invite code ────────────────────────────────────────────

/**
 * POST /api/auth/register — register a new user with an invitation code.
 * Body: { email, password, inviteCode }
 */
export async function handleRegister(req: Request, res: Response): Promise<void> {
  const ip = getClientIp(req);
  const { blocked, retryAfterSec } = checkRateLimit(ip);
  if (blocked) {
    res.status(429).json({ error: `Too many failed attempts. Try again in ${retryAfterSec}s.`, retryAfter: retryAfterSec });
    return;
  }

  const { email, password, inviteCode } = req.body as {
    email?: unknown;
    password?: unknown;
    inviteCode?: unknown;
  };

  // Validate email
  if (typeof email !== 'string' || !email || !isValidEmail(email)) {
    const lockSec = recordFailure(ip);
    res.status(400).json({ error: 'Valid email address is required.', retryAfter: lockSec });
    return;
  }

  // Validate password
  if (typeof password !== 'string' || !password || password.length < 8) {
    const lockSec = recordFailure(ip);
    res.status(400).json({ error: 'Password must be at least 8 characters.', retryAfter: lockSec });
    return;
  }

  // Validate invite code
  if (typeof inviteCode !== 'string' || !inviteCode) {
    const lockSec = recordFailure(ip);
    res.status(400).json({ error: 'Invitation code is required.', retryAfter: lockSec });
    return;
  }

  const db = getDb();
  const rawDb = (db as unknown as { db: import('better-sqlite3').Database }).db;

  // Validate invite code in database
  const invite = rawDb.prepare(
    'SELECT * FROM invite_codes WHERE code = ?'
  ).get(inviteCode) as InviteCodeRow | undefined;

  if (!invite) {
    const lockSec = recordFailure(ip);
    res.status(400).json({ error: 'Invalid invitation code.', retryAfter: lockSec });
    return;
  }

  // Check expiration
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    const lockSec = recordFailure(ip);
    res.status(400).json({ error: 'Invitation code has expired.', retryAfter: lockSec });
    return;
  }

  // Check usage limit
  if (invite.used_count >= invite.max_uses) {
    const lockSec = recordFailure(ip);
    res.status(400).json({ error: 'Invitation code has reached its usage limit.', retryAfter: lockSec });
    return;
  }

  // Check duplicate email
  const existing = rawDb.prepare(
    'SELECT id FROM users WHERE email = ?'
  ).get(email.toLowerCase());
  if (existing) {
    res.status(409).json({ error: 'Email already registered.' });
    return;
  }

  // Hash password and create user
  try {
    const passwordHash = await hashPassword(password);
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();

    rawDb.transaction(() => {
      rawDb.prepare(
        'INSERT INTO users (id, email, password_hash, status, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(userId, email.toLowerCase(), passwordHash, 'active', now);

      // Increment invite code usage
      rawDb.prepare(
        'UPDATE invite_codes SET used_count = used_count + 1 WHERE code = ?'
      ).run(inviteCode);
    })();

    clearFailures(ip);
    res.json({ ok: true, userId });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed.' });
  }
}

// ── Login endpoint handler ──────────────────────────────────────────────────

/**
 * POST /api/auth/login — authenticate with email and password.
 * Body: { email, password }
 * Returns: { ok: true, token, userId, email } on success
 */
export async function handleLogin(req: Request, res: Response): Promise<void> {
  const ip = getClientIp(req);
  const { blocked, retryAfterSec } = checkRateLimit(ip);
  console.log(`[AUTH] Login attempt from IP: ${ip}, blocked: ${blocked}, retryAfter: ${retryAfterSec}`);
  if (blocked) {
    res.status(429).json({ error: `Too many failed attempts. Try again in ${retryAfterSec}s.`, retryAfter: retryAfterSec });
    return;
  }

  const { email, password } = req.body as { email?: unknown; password?: unknown };

  if (typeof email !== 'string' || !email) {
    const lockSec = recordFailure(ip);
    res.status(401).json({ error: `Email is required. Locked for ${lockSec}s.`, retryAfter: lockSec });
    return;
  }

  if (typeof password !== 'string' || !password) {
    const lockSec = recordFailure(ip);
    res.status(401).json({ error: `Password is required. Locked for ${lockSec}s.`, retryAfter: lockSec });
    return;
  }

  const db = getDb();
  const rawDb = (db as unknown as { db: import('better-sqlite3').Database }).db;

  // Find user by email (case-insensitive)
  const user = rawDb.prepare(
    'SELECT * FROM users WHERE email = ? AND status = ?'
  ).get(email.toLowerCase(), 'active') as UserRow | undefined;

  if (!user) {
    const lockSec = recordFailure(ip);
    res.status(401).json({ error: `Invalid credentials. Locked for ${lockSec}s.`, retryAfter: lockSec });
    return;
  }

  // Verify password
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    const lockSec = recordFailure(ip);
    res.status(401).json({ error: `Invalid credentials. Locked for ${lockSec}s.`, retryAfter: lockSec });
    return;
  }

  // Create session token
  const token = createSessionToken(user.id, user.email);

  clearFailures(ip);
  res.json({ ok: true, token, userId: user.id, email: user.email });
}

// ── Token verify endpoint ───────────────────────────────────────────────────

/**
 * GET /api/auth/verify — verify a session token.
 * Header: Authorization: Bearer <token>
 */
export function handleVerify(req: Request, res: Response): void {
  const ip = getClientIp(req);
  const { blocked, retryAfterSec } = checkRateLimit(ip);
  if (blocked) {
    res.status(429).json({ ok: false, retryAfter: retryAfterSec });
    return;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Don't record failure for missing/invalid token - this is normal after service restart
    res.status(401).json({ ok: false });
    return;
  }

  const token = authHeader.slice(7);
  const session = validateSessionToken(token);
  if (!session) {
    // Don't record failure for expired/invalid token - this is normal after service restart
    res.status(401).json({ ok: false });
    return;
  }

  res.json({ ok: true, userId: session.userId, email: session.email });
}

// ── WS ticket endpoint ─────────────────────────────────────────────────────

/**
 * POST /api/auth/ws-ticket — exchange a valid session token for a one-time WS ticket.
 * Header: Authorization: Bearer <token>
 */
export function handleWsTicket(req: Request, res: Response): void {
  const ip = getClientIp(req);
  const { blocked, retryAfterSec } = checkRateLimit(ip);
  if (blocked) {
    res.status(429).json({ error: `Too many failed attempts. Try again in ${retryAfterSec}s.`, retryAfter: retryAfterSec });
    return;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Don't record failure - token absence is normal after logout/service restart
    res.status(401).json({ error: 'Authorization required.' });
    return;
  }

  const token = authHeader.slice(7);
  const session = validateSessionToken(token);
  if (!session) {
    // Don't record failure - expired token is normal after service restart
    res.status(401).json({ error: 'Invalid or expired token.' });
    return;
  }

  res.json({ ticket: createWsTicket(session.userId) });
}

// ── Logout endpoint ─────────────────────────────────────────────────────────

/**
 * POST /api/auth/logout — revoke session token.
 * Header: Authorization: Bearer <token>
 */
export function handleLogout(req: Request, res: Response): void {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    revokeSessionToken(token);
  }
  res.json({ ok: true });
}

// ── Auth status endpoint ────────────────────────────────────────────────────

export function handleAuthStatus(_req: Request, res: Response): void {
  res.json({ authEnabled: true });
}

// ── Middleware ───────────────────────────────────────────────────────────────

/**
 * Express middleware that checks for a valid session token on every request
 * except the auth endpoints themselves and health check.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Always allow auth endpoints and health check.
  if (
    req.path === '/api/auth/login' ||
    req.path === '/api/auth/register' ||
    req.path === '/api/auth/status' ||
    req.path === '/api/auth/verify' ||
    req.path === '/api/auth/ws-ticket' ||
    req.path === '/api/auth/logout' ||
    req.path === '/api/health'
  ) {
    next();
    return;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization required.' });
    return;
  }

  const token = authHeader.slice(7);
  const session = validateSessionToken(token);
  if (!session) {
    res.status(401).json({ error: 'Invalid or expired token.' });
    return;
  }

  // Attach user info to request for downstream handlers
  (req as Request & { user?: { userId: string; email: string } }).user = {
    userId: session.userId,
    email: session.email,
  };

  next();
}
