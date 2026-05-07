import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { NotebookDb } from './db.js';
import { SessionCache, type SessionToken } from './session-cache.js';
import { requireAuth, extractToken, COOKIE_NAME } from './auth-helpers.js';

// ── Configuration ────────────────────────────────────────────────────────────

const TRUST_PROXY = !!process.env['TRUST_PROXY'];

/**
 * Auth is enabled unless NB_AUTH_DISABLED=1 (for testing only).
 * In production, always leave this unset.
 */
export const authEnabled = process.env['NB_AUTH_DISABLED'] !== '1';

/**
 * Auth mode: 'token' (default) or 'password'.
 * - token: single shared secret via NB_AUTH_TOKEN env var
 * - password: user/password with database (multi-user, future)
 */
export const authMode: 'token' | 'password' =
  (process.env['NB_AUTH_MODE'] === 'password') ? 'password' : 'token';

// ── Brute-force protection ──────────────────────────────────────────────────

interface FailRecord {
  count: number;
  lockedUntil: number; // epoch ms
}

// Rate limit map for login/register brute-force protection only.
// /verify and /ws-ticket don't need rate limiting (64-char random tokens).
const failMap = new Map<string, FailRecord>();

/** Base lockout in ms after first failure. Doubles each subsequent failure. */
export const BASE_LOCKOUT_MS = 60_000;
/** Base lockout in seconds (for display/sharing with frontend). */
export const BASE_LOCKOUT_SEC = BASE_LOCKOUT_MS / 1000;
/** Max lockout cap: 30 minutes. */
export const MAX_LOCKOUT_MS = 30 * 60_000;
/** Minimum password length for registration (D6: extracted constant). */
export const MIN_PASSWORD_LENGTH = 8;

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
// Delegated to SessionCache. The wrapper exports below preserve the external
// API used elsewhere in the codebase.

export const sessionCache = new SessionCache({ getDb: () => getDb() });

export function createSessionToken(userId: string, email: string): string {
  return sessionCache.create(userId, email);
}

export function validateSessionToken(token: string): SessionToken | null {
  return sessionCache.validate(token);
}

export function revokeSessionToken(token: string): void {
  sessionCache.revoke(token);
}

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
  if (typeof password !== 'string' || !password || password.length < MIN_PASSWORD_LENGTH) {
    const lockSec = recordFailure(ip);
    res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, retryAfter: lockSec });
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
  // D2: Removed console.log that exposed IP addresses in production logs
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
  // No rate limiting for /verify:
  // - Token is 64-char random string, brute-force is infeasible
  // - Token expiry is normal (browser refresh, session restart)
  // - Frontend only calls this once per page load
  // /verify is a boolean check — body is { ok: bool }, not { error }.
  // Other endpoints (ws-ticket, middleware) carry an error message.
  const r = requireAuth(req);
  if (!r.ok) { res.status(r.status).json({ ok: false }); return; }
  res.json({ ok: true, userId: r.session.userId, email: r.session.email });
}

// ── WS ticket endpoint ─────────────────────────────────────────────────────

/**
 * POST /api/auth/ws-ticket — exchange a valid session token for a one-time WS ticket.
 * Header: Authorization: Bearer <token>
 */
export function handleWsTicket(req: Request, res: Response): void {
  // No rate limiting for /ws-ticket:
  // - Requires valid session token (already authenticated)
  // - Token is 64-char random string, can't be guessed
  // - Only called when establishing WebSocket connection
  const r = requireAuth(req);
  if (!r.ok) { res.status(r.status).json({ error: r.error }); return; }
  res.json({ ticket: createWsTicket(r.session.userId) });
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

// ── Token login endpoint ─────────────────────────────────────────────────────

/**
 * POST /api/auth/login-token — authenticate with a shared secret token.
 * Body: { token }
 * Returns: { ok: true, token } (session token) on success
 */
export async function handleTokenLogin(req: Request, res: Response): Promise<void> {
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

  const expected = process.env['NB_AUTH_TOKEN'];
  if (!expected || expected.length < 24) {
    res.status(500).json({ error: 'NB_AUTH_TOKEN not configured or too short (min 24 chars).' });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  const valid = tokenBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(tokenBuf, expectedBuf);

  if (!valid) {
    const lockSec = recordFailure(ip);
    res.status(401).json({ error: `Invalid token. Locked for ${lockSec}s.`, retryAfter: lockSec });
    return;
  }

  // Create session token (reuse existing session infrastructure)
  const sessionToken = createSessionToken('token-user', 'token@local');
  clearFailures(ip);
  res.json({ ok: true, token: sessionToken, userId: 'token-user', email: 'token@local' });
}

// ── Auth status endpoint ────────────────────────────────────────────────────

export function handleAuthStatus(_req: Request, res: Response): void {
  // Auth is always required for frontend — NB_AUTH_DISABLED only disables
  // server-side checks for testing, it doesn't change frontend requirements.
  res.json({ authEnabled: true, authMode });
}

// ── Middleware ───────────────────────────────────────────────────────────────

/**
 * Express middleware that checks for a valid session token on every request
 * except the auth endpoints themselves and health check.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (
    req.path === '/api/auth/login' ||
    req.path === '/api/auth/login-token' ||
    req.path === '/api/auth/register' ||
    req.path === '/api/auth/status' ||
    req.path === '/api/auth/verify' ||
    req.path === '/api/auth/ws-ticket' ||
    req.path === '/api/auth/logout' ||
    req.path === '/api/health'
  ) { next(); return; }

  const r = requireAuth(req);
  if (!r.ok) {
    if (extractToken(req)) res.clearCookie(COOKIE_NAME, { path: '/' });
    res.status(r.status).json({ error: r.error });
    return;
  }
  (req as Request & { user?: { userId: string; email: string } }).user = {
    userId: r.session.userId,
    email: r.session.email,
  };
  next();
}
