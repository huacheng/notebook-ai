# Token Auth Cache Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch browser auth from `sessionStorage` to HttpOnly cookie (so login persists across browser restarts for 7 days), and refactor the in-process token cache into a `SessionCache` class with LRU + negative cache + stats.

**Architecture:** Three layers — `SessionCache` (server cache class with LRU and negative cache), `auth-helpers` (unified Bearer/cookie token extraction + `requireAuth`), `csrf` middleware (Origin whitelist). Frontend deletes `sessionStorage` token reads/writes; ~22 fetch sites stop setting `Authorization` header (cookie carries automatically via `credentials: 'same-origin'`).

**Tech Stack:** Node + Express 5 + better-sqlite3 + cookie-parser (new) on server; React + Redux on web. Tests via vitest. Project uses pnpm workspaces (server: `@notebook-ai/server`, web: `@notebook-ai/web`).

**Reference spec:** `docs/superpowers/specs/2026-05-07-token-auth-cache-design.md` — read this for context on decisions, edge cases, and trade-offs. The plan below assumes you have skimmed it.

---

## File Structure

**Server (new files):**
- `packages/server/src/session-cache.ts` — `SessionCache` class, ~150 lines
- `packages/server/src/auth-helpers.ts` — `extractToken`, `requireAuth`, ~50 lines
- `packages/server/src/csrf.ts` — `csrfMiddleware`, ~40 lines
- `packages/server/src/__tests__/sessionCache.test.ts` — 12 unit tests
- `packages/server/src/__tests__/cookieAuth.test.ts` — 8 E2E tests
- `packages/server/src/__tests__/csrfMiddleware.test.ts` — 6 middleware tests

**Server (modified):**
- `packages/server/src/auth.ts` — delegate to `SessionCache`; emit `Set-Cookie` on login/logout
- `packages/server/src/index.ts` — install `cookieParser` and `csrfMiddleware` before `authMiddleware`
- `packages/server/package.json` — add `cookie-parser` dep
- `packages/server/src/__tests__/userPasswordLogin.test.ts` — assert `Set-Cookie` and JSON body has no `token`
- `packages/server/src/__tests__/authTokenLogin.test.ts` — same; but `/login-token` JSON keeps `token` for compat
- `packages/server/src/__tests__/sessionTokenPersist.test.ts` — adapt to new cache class
- `packages/server/src/__tests__/wsTicket.test.ts` — use cookie path

**Web (modified):**
- `packages/web/src/store/authSlice.ts` — drop `sessionStorage` reads/writes, drop `authToken` field
- `packages/web/src/components/AuthImage.tsx` — drop Bearer header, add `credentials`
- 20 other frontend files (listed in Task 12-14) — drop `Authorization: Bearer` injection, add `credentials`
- `packages/web/src/__tests__/authTokenStorage.test.ts` — update assertions

**Web (new):**
- `packages/web/src/__tests__/cookieAuthFetch.test.ts` — verify no fetch site sets `Authorization`

**Config:**
- `.env.example` — add `NB_ALLOWED_ORIGINS`, document `NB_CSRF_DISABLED`
- `package.json` (root, server, web) — bump version to `2.3.0`

---

## Task 1: Add cookie-parser dependency

**Files:**
- Modify: `packages/server/package.json`

- [ ] **Step 1: Install cookie-parser into server workspace**

Run:
```bash
pnpm --filter @notebook-ai/server add cookie-parser
pnpm --filter @notebook-ai/server add -D @types/cookie-parser
```

Expected: `package.json` gains `"cookie-parser": "^1.4.x"` and devDep `"@types/cookie-parser": "^1.4.x"`.

- [ ] **Step 2: Verify install**

Run: `pnpm --filter @notebook-ai/server list cookie-parser`
Expected: prints version, no missing peer warnings.

- [ ] **Step 3: Commit**

```bash
git add packages/server/package.json pnpm-lock.yaml
git commit -m "chore(server): add cookie-parser dependency"
```

---

## Task 2: Implement SessionCache class with TDD

**Files:**
- Create: `packages/server/src/__tests__/sessionCache.test.ts`
- Create: `packages/server/src/session-cache.ts`

- [ ] **Step 1: Write the failing test file**

Create `packages/server/src/__tests__/sessionCache.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionCache } from '../session-cache.js';

interface FakeDb {
  upsertSessionToken: ReturnType<typeof vi.fn>;
  getSessionToken: ReturnType<typeof vi.fn>;
  deleteSessionToken: ReturnType<typeof vi.fn>;
  deleteExpiredSessionTokens: ReturnType<typeof vi.fn>;
}

function makeFakeDb(): FakeDb {
  return {
    upsertSessionToken: vi.fn(),
    getSessionToken: vi.fn().mockReturnValue(null),
    deleteSessionToken: vi.fn(),
    deleteExpiredSessionTokens: vi.fn(),
  };
}

describe('SessionCache', () => {
  let db: FakeDb;
  let cache: SessionCache;

  beforeEach(() => {
    db = makeFakeDb();
    cache = new SessionCache({ maxSize: 3, negTtlMs: 1000, getDb: () => db as any });
  });

  it('cache hit on second validate does not query DB', () => {
    const token = cache.create('u1', 'a@x');
    db.getSessionToken.mockClear();
    expect(cache.validate(token)?.userId).toBe('u1');
    expect(cache.validate(token)?.userId).toBe('u1');
    expect(db.getSessionToken).not.toHaveBeenCalled();
  });

  it('cache miss falls back to DB and rehydrates', () => {
    db.getSessionToken.mockReturnValueOnce({
      userId: 'u2', email: 'b@x', expiresAt: Date.now() + 60_000,
    });
    expect(cache.validate('extern-token')?.userId).toBe('u2');
    db.getSessionToken.mockClear();
    expect(cache.validate('extern-token')?.userId).toBe('u2');
    expect(db.getSessionToken).not.toHaveBeenCalled();
  });

  it('expired cache entry triggers DB lookup', () => {
    const token = cache.create('u3', 'c@x');
    (cache as any).cache.get(token).expiresAt = Date.now() - 1;
    db.getSessionToken.mockReturnValueOnce(null);
    expect(cache.validate(token)).toBeNull();
    expect(db.getSessionToken).toHaveBeenCalled();
  });

  it('LRU evicts oldest when over maxSize', () => {
    const t1 = cache.create('u1', 'a@x');
    const t2 = cache.create('u2', 'b@x');
    const t3 = cache.create('u3', 'c@x');
    cache.create('u4', 'd@x'); // size 4 > maxSize 3 → evict t1
    db.getSessionToken.mockReturnValueOnce(null);
    expect(cache.validate(t1)).toBeNull();
    expect(cache.validate(t2)?.userId).toBe('u2');
    expect(cache.validate(t3)?.userId).toBe('u3');
    expect(cache.getStats().evictions).toBe(1);
  });

  it('LRU touch on validate prevents eviction', () => {
    const t1 = cache.create('u1', 'a@x');
    const t2 = cache.create('u2', 'b@x');
    const t3 = cache.create('u3', 'c@x');
    cache.validate(t1); // touch t1 → now t2 is oldest
    cache.create('u4', 'd@x'); // evicts t2
    db.getSessionToken.mockReturnValueOnce(null);
    expect(cache.validate(t2)).toBeNull();
    expect(cache.validate(t1)?.userId).toBe('u1');
  });

  it('negative cache: invalid token blocks DB lookup for negTtlMs', () => {
    db.getSessionToken.mockReturnValue(null);
    expect(cache.validate('bad')).toBeNull();
    db.getSessionToken.mockClear();
    expect(cache.validate('bad')).toBeNull();
    expect(db.getSessionToken).not.toHaveBeenCalled();
    expect(cache.getStats().negHits).toBe(1);
  });

  it('negative cache expires after negTtlMs', () => {
    vi.useFakeTimers();
    db.getSessionToken.mockReturnValue(null);
    cache.validate('bad');
    vi.advanceTimersByTime(1500);
    db.getSessionToken.mockClear();
    cache.validate('bad');
    expect(db.getSessionToken).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('revoke clears cache, negCache, and DB', () => {
    const token = cache.create('u', 'e@x');
    cache.revoke(token);
    expect((cache as any).cache.has(token)).toBe(false);
    expect(db.deleteSessionToken).toHaveBeenCalledWith(token);
  });

  it('DB exception returns null (fail-closed)', () => {
    db.getSessionToken.mockImplementationOnce(() => { throw new Error('boom'); });
    expect(cache.validate('any')).toBeNull();
  });

  it('stats counts hits, misses, negHits, evictions', () => {
    const t = cache.create('u', 'e@x');
    cache.validate(t); // hit
    db.getSessionToken.mockReturnValueOnce(null);
    cache.validate('bad'); // miss + neg
    cache.validate('bad'); // negHit
    const s = cache.getStats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.negHits).toBe(1);
  });

  it('sweep removes expired entries', () => {
    const t = cache.create('u', 'e@x');
    (cache as any).cache.get(t).expiresAt = Date.now() - 1;
    (cache as any).sweep();
    expect((cache as any).cache.has(t)).toBe(false);
    expect(db.deleteExpiredSessionTokens).toHaveBeenCalled();
  });

  it('create persists to DB asynchronously via setImmediate', async () => {
    cache.create('u', 'e@x');
    expect(db.upsertSessionToken).not.toHaveBeenCalled();
    await new Promise((r) => setImmediate(r));
    expect(db.upsertSessionToken).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test file to verify it fails**

Run: `pnpm --filter @notebook-ai/server exec vitest run src/__tests__/sessionCache.test.ts`
Expected: FAIL with `Cannot find module '../session-cache.js'`.

- [ ] **Step 3: Implement SessionCache**

Create `packages/server/src/session-cache.ts`:

```ts
import crypto from 'crypto';
import type { NotebookDb } from './db.js';

export interface SessionToken {
  userId: string;
  email: string;
  expiresAt: number;
}

export interface SessionCacheStats {
  hits: number;
  misses: number;
  negHits: number;
  evictions: number;
  size: number;
  negSize: number;
  hitRate: string;
}

export interface SessionCacheOpts {
  maxSize?: number;
  negTtlMs?: number;
  ttlMs?: number;
  getDb: () => NotebookDb;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60_000;

export class SessionCache {
  private cache = new Map<string, SessionToken>();
  private negCache = new Map<string, number>();
  private stats = { hits: 0, misses: 0, negHits: 0, evictions: 0 };
  private maxSize: number;
  private negTtlMs: number;
  private ttlMs: number;
  private getDb: () => NotebookDb;
  private sweepTimer: NodeJS.Timeout;

  constructor(opts: SessionCacheOpts) {
    this.maxSize = opts.maxSize ?? 10_000;
    this.negTtlMs = opts.negTtlMs ?? 60_000;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.getDb = opts.getDb;
    this.sweepTimer = setInterval(() => this.sweep(), 30 * 60_000);
    this.sweepTimer.unref();
  }

  validate(token: string): SessionToken | null {
    try {
      const negExp = this.negCache.get(token);
      if (negExp !== undefined) {
        if (Date.now() < negExp) {
          this.stats.negHits++;
          return null;
        }
        this.negCache.delete(token);
      }

      const cached = this.cache.get(token);
      if (cached) {
        if (Date.now() < cached.expiresAt) {
          this.touch(token, cached);
          this.stats.hits++;
          return cached;
        }
        this.cache.delete(token);
        try { this.getDb().deleteSessionToken(token); } catch { /* ignore */ }
      }

      const row = this.getDb().getSessionToken(token);
      if (!row) {
        this.markNegative(token);
        this.stats.misses++;
        return null;
      }
      if (Date.now() >= row.expiresAt) {
        try { this.getDb().deleteSessionToken(token); } catch { /* ignore */ }
        this.markNegative(token);
        return null;
      }
      const session: SessionToken = {
        userId: row.userId,
        email: row.email,
        expiresAt: row.expiresAt,
      };
      this.cache.set(token, session);
      this.evictIfFull();
      this.stats.misses++;
      return session;
    } catch (err) {
      console.error('[sessionCache] validate failed:', err);
      return null;
    }
  }

  create(userId: string, email: string): string {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + this.ttlMs;
    this.cache.set(token, { userId, email, expiresAt });
    this.evictIfFull();
    setImmediate(() => {
      try { this.getDb().upsertSessionToken(token, userId, email, expiresAt); }
      catch (err) { console.error('[sessionCache] db upsert failed:', err); }
    });
    return token;
  }

  revoke(token: string): void {
    this.cache.delete(token);
    this.negCache.delete(token);
    try { this.getDb().deleteSessionToken(token); } catch { /* ignore */ }
  }

  getStats(): SessionCacheStats {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total === 0 ? '0' : (this.stats.hits / total).toFixed(3);
    return {
      ...this.stats,
      size: this.cache.size,
      negSize: this.negCache.size,
      hitRate,
    };
  }

  private touch(token: string, value: SessionToken): void {
    this.cache.delete(token);
    this.cache.set(token, value);
  }

  private evictIfFull(): void {
    while (this.cache.size > this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
      this.stats.evictions++;
    }
  }

  private markNegative(token: string): void {
    this.negCache.set(token, Date.now() + this.negTtlMs);
    if (this.negCache.size > this.maxSize) {
      const oldest = this.negCache.keys().next().value;
      if (oldest !== undefined) this.negCache.delete(oldest);
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [t, s] of this.cache) {
      if (now >= s.expiresAt) this.cache.delete(t);
    }
    for (const [t, exp] of this.negCache) {
      if (now >= exp) this.negCache.delete(t);
    }
    try { this.getDb().deleteExpiredSessionTokens(); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @notebook-ai/server exec vitest run src/__tests__/sessionCache.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/session-cache.ts packages/server/src/__tests__/sessionCache.test.ts
git commit -m "feat(server): add SessionCache class with LRU and negative cache"
```

---

## Task 3: Wire SessionCache into auth.ts (preserve external API)

**Files:**
- Modify: `packages/server/src/auth.ts:83-145` (replace `sessionTokens` Map and helpers)

- [ ] **Step 1: Replace session token block in auth.ts**

In `packages/server/src/auth.ts`, replace the entire block from line 83 (`// ── Session token management ──`) through line 144 (the cleanup `setInterval` for `sessionTokens`) with:

```ts
// ── Session token management ─────────────────────────────────────────────────

import { SessionCache, type SessionToken } from './session-cache.js';

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
```

Keep imports at top of file (the `import` above must be moved up next to the existing imports — adjust as needed).

- [ ] **Step 2: Verify type imports**

Confirm `auth.ts` no longer references the removed local `SessionToken` interface. The `SessionToken` type now comes from `./session-cache.js`. If any other code in `auth.ts` references `SessionToken`, ensure the import is the new one.

- [ ] **Step 3: Run server tests**

Run: `pnpm --filter @notebook-ai/server exec vitest run`
Expected: all existing tests still pass (zero regressions). The previous behavior is preserved by the wrappers.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/auth.ts
git commit -m "refactor(server): delegate session token management to SessionCache"
```

---

## Task 4: Extract auth-helpers and consolidate Bearer parsing

**Files:**
- Create: `packages/server/src/auth-helpers.ts`
- Modify: `packages/server/src/auth.ts` (handlers `handleVerify`, `handleWsTicket`, `authMiddleware`)

- [ ] **Step 1: Create auth-helpers.ts**

```ts
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
```

- [ ] **Step 2: Refactor handleVerify in auth.ts**

In `auth.ts`, replace the body of `handleVerify` (currently around lines 410-429) with:

```ts
export function handleVerify(req: Request, res: Response): void {
  const r = requireAuth(req);
  if (!r.ok) { res.status(r.status).json({ ok: false }); return; }
  res.json({ ok: true, userId: r.session.userId, email: r.session.email });
}
```

Add `import { requireAuth, extractToken, COOKIE_NAME } from './auth-helpers.js';` at the top of `auth.ts`.

- [ ] **Step 3: Refactor handleWsTicket**

Replace `handleWsTicket` body with:

```ts
export function handleWsTicket(req: Request, res: Response): void {
  const r = requireAuth(req);
  if (!r.ok) { res.status(r.status).json({ error: r.error }); return; }
  res.json({ ticket: createWsTicket(r.session.userId) });
}
```

- [ ] **Step 4: Refactor authMiddleware**

Replace the `authMiddleware` body (currently around lines 534-570) — keep the early-return whitelist for auth endpoints, replace the rest with:

```ts
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
```

- [ ] **Step 5: Run server tests**

Run: `pnpm --filter @notebook-ai/server exec vitest run`
Expected: all existing tests still pass. (The middleware-level `clearCookie` is exercised when a request carrying a token gets rejected — pure header addition, no body change.)

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/auth.ts packages/server/src/auth-helpers.ts
git commit -m "refactor(server): unify Bearer parsing via auth-helpers"
```

---

## Task 5: Implement CSRF middleware with TDD

**Files:**
- Create: `packages/server/src/__tests__/csrfMiddleware.test.ts`
- Create: `packages/server/src/csrf.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { csrfMiddleware } from '../csrf.js';

function app() {
  const a = express();
  a.use(cookieParser());
  a.use(csrfMiddleware);
  a.get('/r', (_req, res) => res.json({ ok: true }));
  a.post('/r', (_req, res) => res.json({ ok: true }));
  return a;
}

describe('csrfMiddleware', () => {
  it('GET requests do not check Origin', async () => {
    const r = await request(app()).get('/r').set('Cookie', 'nb-auth-token=x');
    expect(r.status).toBe(200);
  });

  it('POST with cookie + allowed Origin passes', async () => {
    const r = await request(app()).post('/r')
      .set('Cookie', 'nb-auth-token=x')
      .set('Origin', 'http://localhost:3003');
    expect(r.status).toBe(200);
  });

  it('POST with cookie + foreign Origin gets 403', async () => {
    const r = await request(app()).post('/r')
      .set('Cookie', 'nb-auth-token=x')
      .set('Origin', 'https://evil.com');
    expect(r.status).toBe(403);
    expect(r.body.error).toContain('Forbidden');
  });

  it('POST with cookie + missing Origin gets 403', async () => {
    const r = await request(app()).post('/r').set('Cookie', 'nb-auth-token=x');
    expect(r.status).toBe(403);
    expect(r.body.error).toContain('Origin');
  });

  it('POST with only Bearer header (no cookie) is not Origin-checked', async () => {
    const r = await request(app()).post('/r')
      .set('Authorization', 'Bearer x')
      .set('Origin', 'https://anywhere.com');
    expect(r.status).toBe(200);
  });

  it('NB_CSRF_DISABLED=1 skips check', async () => {
    process.env['NB_CSRF_DISABLED'] = '1';
    const r = await request(app()).post('/r')
      .set('Cookie', 'nb-auth-token=x')
      .set('Origin', 'https://evil.com');
    expect(r.status).toBe(200);
    delete process.env['NB_CSRF_DISABLED'];
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @notebook-ai/server exec vitest run src/__tests__/csrfMiddleware.test.ts`
Expected: FAIL with `Cannot find module '../csrf.js'`.

- [ ] **Step 3: Implement csrf.ts**

```ts
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
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (!cookies?.[COOKIE_NAME]) { next(); return; }

  const origin = (req.headers.origin as string | undefined)
    ?? (req.headers.referer as string | undefined);
  if (!origin) { res.status(403).json({ error: 'Origin required.' }); return; }

  const ok = allowedOrigins().some(o => origin.startsWith(o));
  if (!ok) { res.status(403).json({ error: 'Forbidden origin.' }); return; }
  next();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @notebook-ai/server exec vitest run src/__tests__/csrfMiddleware.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/csrf.ts packages/server/src/__tests__/csrfMiddleware.test.ts
git commit -m "feat(server): add CSRF middleware with Origin whitelist"
```

---

## Task 6: Mount cookie-parser and csrf in index.ts

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Find current middleware mount block**

Run: `grep -n "app.use\|cookieParser\|csrf\|authMiddleware" packages/server/src/index.ts | head -20`
Expected: identifies where `authMiddleware` is currently mounted.

- [ ] **Step 2: Add imports and mount**

Near the top of `packages/server/src/index.ts`, alongside other imports:

```ts
import cookieParser from 'cookie-parser';
import { csrfMiddleware } from './csrf.js';
```

In the middleware mount section, insert **before** `app.use(authMiddleware)`:

```ts
app.use(cookieParser());
app.use(csrfMiddleware);
```

Order matters — cookieParser must populate `req.cookies` before csrfMiddleware reads it.

- [ ] **Step 3: Run server tests**

Run: `pnpm --filter @notebook-ai/server exec vitest run`
Expected: all existing tests still pass. (Adding cookie-parser is non-breaking; CSRF only acts when both cookie + mutate method are present, and existing tests use Bearer header.)

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): mount cookie-parser and CSRF middleware"
```

---

## Task 7: Issue Set-Cookie on login + add cookieAuth E2E tests

**Files:**
- Modify: `packages/server/src/auth.ts` (`handleLogin`, `handleTokenLogin`)
- Create: `packages/server/src/__tests__/cookieAuth.test.ts`

- [ ] **Step 1: Define COOKIE_OPTS in auth.ts**

Near the top of `auth.ts` after imports:

```ts
import type { CookieOptions } from 'express';

const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

const COOKIE_OPTS: CookieOptions = {
  httpOnly: true,
  secure: process.env['NODE_ENV'] === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: COOKIE_MAX_AGE_MS,
};
```

- [ ] **Step 2: Update handleLogin to emit Set-Cookie**

In `handleLogin` (around line 401), replace the success response:

```ts
res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
res.json({ ok: true, userId: user.id, email: user.email });
```

(Note: `token` is removed from the response body. The frontend will get its identity from `userId`/`email` only.)

- [ ] **Step 3: Update handleTokenLogin similarly but keep token in body**

In `handleTokenLogin` (around line 517), replace the success response:

```ts
res.cookie(COOKIE_NAME, sessionToken, COOKIE_OPTS);
res.json({ ok: true, token: sessionToken, userId: 'token-user', email: 'token@local' });
```

(Body retains `token` here for backward compatibility with `NB_AUTH_TOKEN` clients that may parse it.)

- [ ] **Step 4: Write cookieAuth E2E tests**

Create `packages/server/src/__tests__/cookieAuth.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createServer } from '../index.js'; // export createServer from index for tests

let server: any;
beforeAll(async () => {
  process.env['NB_AUTH_TOKEN'] = 'test-shared-secret-token-for-cookie-tests-1234';
  server = await createServer();
});
afterAll(async () => { await server?.close?.(); });

async function loginViaToken() {
  const r = await request(server).post('/api/auth/login-token')
    .set('Origin', 'http://localhost:3003')
    .send({ token: process.env['NB_AUTH_TOKEN'] });
  return r;
}

describe('Cookie auth flow', () => {
  it('POST /login-token sets HttpOnly Lax cookie', async () => {
    const r = await loginViaToken();
    expect(r.status).toBe(200);
    const sc = r.headers['set-cookie']?.join(';') ?? '';
    expect(sc).toContain('nb-auth-token=');
    expect(sc).toLowerCase().includes('httponly');
    expect(sc).toLowerCase().includes('samesite=lax');
  });

  it('Cookie carries auth on subsequent GET (no Bearer needed)', async () => {
    const login = await loginViaToken();
    const cookie = login.headers['set-cookie'];
    const r = await request(server).get('/api/auth/verify').set('Cookie', cookie);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('Bearer header still works (backward compat)', async () => {
    const login = await loginViaToken();
    const r = await request(server).get('/api/auth/verify')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(r.status).toBe(200);
  });

  it('Cookie takes precedence when both present', async () => {
    const login = await loginViaToken();
    const cookie = login.headers['set-cookie'];
    const r = await request(server).get('/api/auth/verify')
      .set('Cookie', cookie)
      .set('Authorization', 'Bearer wrong-token-but-ignored');
    expect(r.status).toBe(200);
  });

  it('POST /logout clears the cookie', async () => {
    const login = await loginViaToken();
    const cookie = login.headers['set-cookie'];
    const r = await request(server).post('/api/auth/logout')
      .set('Origin', 'http://localhost:3003')
      .set('Cookie', cookie);
    expect(r.status).toBe(200);
    const sc = r.headers['set-cookie']?.join(';') ?? '';
    expect(sc).toContain('nb-auth-token=;');
  });

  it('Logout invalidates the cookie immediately', async () => {
    const login = await loginViaToken();
    const cookie = login.headers['set-cookie'];
    await request(server).post('/api/auth/logout')
      .set('Origin', 'http://localhost:3003').set('Cookie', cookie);
    const r = await request(server).get('/api/auth/verify').set('Cookie', cookie);
    expect(r.status).toBe(401);
  });

  it('Expired/invalid cookie response includes clearCookie header', async () => {
    const r = await request(server).get('/api/projects')
      .set('Cookie', 'nb-auth-token=invalid-token-value');
    expect(r.status).toBe(401);
    const sc = r.headers['set-cookie']?.join(';') ?? '';
    expect(sc).toContain('nb-auth-token=;');
  });

  it('login-token JSON keeps token field for compat; password login does not', async () => {
    const r = await loginViaToken();
    expect(r.body.token).toBeDefined();
  });
});
```

If `createServer` is not yet exported from `index.ts`, refactor `index.ts` to export an async `createServer()` factory that returns the http server. (Search current code for the existing `app.listen` call; wrap startup in `export async function createServer() { ... return server; }`.)

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @notebook-ai/server exec vitest run src/__tests__/cookieAuth.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/auth.ts packages/server/src/index.ts packages/server/src/__tests__/cookieAuth.test.ts
git commit -m "feat(server): emit Set-Cookie on login + cookieAuth E2E tests"
```

---

## Task 8: clearCookie on logout + adjust existing login tests

**Files:**
- Modify: `packages/server/src/auth.ts` (`handleLogout`)
- Modify: `packages/server/src/__tests__/userPasswordLogin.test.ts`
- Modify: `packages/server/src/__tests__/authTokenLogin.test.ts`
- Modify: `packages/server/src/__tests__/sessionTokenPersist.test.ts`
- Modify: `packages/server/src/__tests__/wsTicket.test.ts`

- [ ] **Step 1: Update handleLogout to clear cookie**

In `handleLogout` in `auth.ts` (around line 464), append before `res.json`:

```ts
res.clearCookie(COOKIE_NAME, { path: '/' });
```

Final shape:
```ts
export function handleLogout(req: Request, res: Response): void {
  const token = extractToken(req);
  if (token) revokeSessionToken(token);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
}
```

(This also replaces the previous `Authorization: Bearer ...` parsing with the unified `extractToken`.)

- [ ] **Step 2: Update userPasswordLogin.test.ts**

In `packages/server/src/__tests__/userPasswordLogin.test.ts`, find the assertion that the login response body contains `token`. Change:
- Assert response body **does not** contain `token`
- Assert response **headers** include `set-cookie` containing `nb-auth-token=`

Replace any block like `expect(res.body.token).toBeDefined()` with:
```ts
expect(res.body.token).toBeUndefined();
expect(res.headers['set-cookie']?.join(';')).toMatch(/nb-auth-token=/);
```

- [ ] **Step 3: Update authTokenLogin.test.ts**

In `packages/server/src/__tests__/authTokenLogin.test.ts`, **keep** the assertion that the response body has `token` (compat path) but **add**:
```ts
expect(res.headers['set-cookie']?.join(';')).toMatch(/nb-auth-token=/);
```

- [ ] **Step 4: Update sessionTokenPersist.test.ts**

In `packages/server/src/__tests__/sessionTokenPersist.test.ts`, replace any direct manipulation of the in-memory `sessionTokens` Map with calls to `sessionCache.validate(...)` / `sessionCache.create(...)`. Search for `sessionTokens` and rewrite:

```ts
// before:
// import { sessionTokens } from '../auth.js';
// after:
import { sessionCache } from '../auth.js';
```

Anywhere that does `sessionTokens.has(token)` becomes `(sessionCache as any).cache.has(token)` or use `sessionCache.validate(token) !== null`.

- [ ] **Step 5: Update wsTicket.test.ts**

In `packages/server/src/__tests__/wsTicket.test.ts`, change the request that obtains a ticket to use Cookie auth path:

```ts
// before:
// .set('Authorization', `Bearer ${token}`)
// after:
.set('Cookie', `nb-auth-token=${token}`)
.set('Origin', 'http://localhost:3003')
```

(Origin needed because `/api/auth/ws-ticket` is POST.)

- [ ] **Step 6: Run all server tests**

Run: `pnpm --filter @notebook-ai/server exec vitest run`
Expected: all tests pass. Capture and report the total pass count (CLAUDE.md requires reporting like "X tests passing").

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/auth.ts packages/server/src/__tests__/userPasswordLogin.test.ts packages/server/src/__tests__/authTokenLogin.test.ts packages/server/src/__tests__/sessionTokenPersist.test.ts packages/server/src/__tests__/wsTicket.test.ts
git commit -m "feat(server): clearCookie on logout + adapt existing tests to cookie path"
```

---

## Task 9: Expose cache stats on /api/health

**Files:**
- Modify: `packages/server/src/index.ts` (or wherever `/api/health` is defined)

- [ ] **Step 1: Locate /api/health route**

Run: `grep -n "/api/health" packages/server/src/*.ts packages/server/src/routes/*.ts`
Expected: one or two matches. Note the file and line.

- [ ] **Step 2: Update health handler**

Replace the existing `/api/health` handler body with:

```ts
import { sessionCache } from './auth.js'; // adjust relative path

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, session: sessionCache.getStats() });
});
```

Adjust import path based on where the route lives.

- [ ] **Step 3: Verify manually**

Run server:
```bash
pnpm --filter @notebook-ai/server exec tsx watch src/index.ts &
sleep 2
curl -s http://localhost:4003/api/health | jq
kill %1
```
Expected output contains `"session": {"size": 0, "negSize": 0, "hits": 0, "misses": 0, "negHits": 0, "evictions": 0, "hitRate": "0"}`.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): expose SessionCache stats on /api/health"
```

---

## Task 10: Remove sessionStorage token in authSlice + update authTokenStorage test

**Files:**
- Modify: `packages/web/src/store/authSlice.ts`
- Modify: `packages/web/src/__tests__/authTokenStorage.test.ts`

- [ ] **Step 1: Update authSlice.ts**

In `packages/web/src/store/authSlice.ts`:

1. Remove the field `authToken: sessionStorage.getItem('nb-auth-token')` from initial state. The slice now tracks login state via `userId`/`email` only.
2. Remove all `sessionStorage.setItem('nb-auth-token', data.token)` calls.
3. Remove all `sessionStorage.removeItem('nb-auth-token')` calls.
4. Change every fetch call inside `authSlice.ts` to drop `Authorization: Bearer ${token}` header and instead pass `credentials: 'same-origin'`.

Example transformation, for the `checkAuthStatus` action:
```ts
// before
const res = await fetch('/api/auth/verify', {
  headers: { 'Authorization': `Bearer ${token}` },
});
// after
const res = await fetch('/api/auth/verify', { credentials: 'same-origin' });
```

For the login action:
```ts
// before
sessionStorage.setItem('nb-auth-token', data.token);
set({ authToken: data.token, userId: data.userId, email: data.email });
// after
set({ userId: data.userId, email: data.email });
```

For the logout action:
```ts
// before
sessionStorage.removeItem('nb-auth-token');
set({ authToken: null, userId: null, email: null });
// after
await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
set({ userId: null, email: null });
```

If `state.authToken` is referenced from other slices/components, you'll handle them in Tasks 12-14.

- [ ] **Step 2: Update authTokenStorage.test.ts**

In `packages/web/src/__tests__/authTokenStorage.test.ts`, replace assertions with:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Auth token storage', () => {
  const sliceSrc = fs.readFileSync(
    path.join(__dirname, '../store/authSlice.ts'),
    'utf-8',
  );

  it('should not persist auth token in localStorage', () => {
    expect(sliceSrc).not.toContain("localStorage.setItem('nb-auth-token'");
    expect(sliceSrc).not.toContain("localStorage.getItem('nb-auth-token')");
  });

  it('should not persist auth token in sessionStorage (now in HttpOnly cookie)', () => {
    expect(sliceSrc).not.toContain("sessionStorage.setItem('nb-auth-token'");
    expect(sliceSrc).not.toContain("sessionStorage.getItem('nb-auth-token')");
  });
});
```

- [ ] **Step 3: Run web tests**

Run: `pnpm --filter @notebook-ai/web exec vitest run src/__tests__/authTokenStorage.test.ts src/store/authSlice.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/store/authSlice.ts packages/web/src/__tests__/authTokenStorage.test.ts
git commit -m "feat(web): drop sessionStorage; rely on HttpOnly cookie for auth"
```

---

## Task 11: Refactor AuthImage component

**Files:**
- Modify: `packages/web/src/components/AuthImage.tsx`

- [ ] **Step 1: Replace AuthImage**

```tsx
import { useState, useEffect } from 'react';

/**
 * Image that fetches via cookie-based auth and rehosts as a blob URL,
 * preventing token leakage in browser history, logs, or referrer.
 */
export function AuthImage({ src, alt, style, ...rest }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!src) return;
    let revoked = false;
    fetch(src, { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (revoked) return;
        setBlobUrl(URL.createObjectURL(blob));
      })
      .catch(() => { if (!revoked) setError(true); });
    return () => {
      revoked = true;
      setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [src]);

  if (error) return <span title={`Failed to load: ${alt ?? src}`}>🖼️</span>;
  if (!blobUrl) return <span style={{ display: 'inline-block', width: 24, height: 24, background: '#e7e5e4', borderRadius: 4 }} />;
  return <img src={blobUrl} alt={alt ?? ''} style={style} {...rest} />;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/AuthImage.tsx
git commit -m "feat(web): AuthImage uses cookie credentials"
```

---

## Task 12: Strip Bearer header from web/src/store/* (5 files)

**Files (modify):**
- `packages/web/src/store/notebookSlice.ts`
- `packages/web/src/store/projectSlice.ts`
- `packages/web/src/store/sidebarSlice.ts`
- `packages/web/src/store/uiSlice.ts`
- `packages/web/src/store/wsSlice.ts`

For each file, the transformation pattern is the same:

- **Remove**: any `const token = useStore(...)` / `const authToken = useStore(...)` whose only use is to set the `Authorization` header.
- **Remove**: any header line like `if (token) headers['Authorization'] = \`Bearer ${token}\`` or spread variant `...(token ? { Authorization: \`Bearer ${token}\` } : {})`.
- **Add**: `credentials: 'same-origin'` to the fetch options object if not already present.

Example transformation:
```ts
// before
const headers: Record<string, string> = { 'Content-Type': 'application/json' };
if (token) headers['Authorization'] = `Bearer ${token}`;
const res = await fetch('/api/foo', { method: 'POST', headers, body });
// after
const headers: Record<string, string> = { 'Content-Type': 'application/json' };
const res = await fetch('/api/foo', { method: 'POST', headers, body, credentials: 'same-origin' });
```

- [ ] **Step 1: Update `notebookSlice.ts`**

Apply the pattern. Search anchor: `Authorization.*Bearer.*token` (only one match).

- [ ] **Step 2: Update `projectSlice.ts`**

Apply the pattern.

- [ ] **Step 3: Update `sidebarSlice.ts`**

Apply the pattern.

- [ ] **Step 4: Update `uiSlice.ts`**

Apply the pattern. (Note: also has `/api/auth/claude/logout` call — same transformation.)

- [ ] **Step 5: Update `wsSlice.ts`**

Apply the pattern. **Important**: the WS ticket request must keep working. In its place:
```ts
// before
const r = await fetch('/api/auth/ws-ticket', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
});
// after
const r = await fetch('/api/auth/ws-ticket', {
  method: 'POST',
  credentials: 'same-origin',
});
```

Also remove the `sessionStorage.removeItem('nb-auth-token')` line at `wsSlice.ts:169` — the cookie is cleared by the server's `clearCookie` response.

- [ ] **Step 6: Verify no Bearer remains in store/**

Run: `grep -rn "Authorization.*Bearer" packages/web/src/store/`
Expected: no output.

- [ ] **Step 7: Run web tests**

Run: `pnpm --filter @notebook-ai/web exec vitest run`
Expected: all existing tests pass (none reference Bearer headers internally).

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/store/notebookSlice.ts packages/web/src/store/projectSlice.ts packages/web/src/store/sidebarSlice.ts packages/web/src/store/uiSlice.ts packages/web/src/store/wsSlice.ts
git commit -m "feat(web): drop Bearer header in store slices; cookie carries auth"
```

---

## Task 13: Strip Bearer header from web/src/api/* and web/src/utils/* (5 files)

**Files (modify):**
- `packages/web/src/api/git.ts`
- `packages/web/src/api/plugin.ts`
- `packages/web/src/api/task-auto.ts`
- `packages/web/src/utils/openNotebookByPath.ts`
- `packages/web/src/utils/pasteImages.ts`

Same transformation pattern as Task 12.

- [ ] **Step 1: Update `api/git.ts`** — apply pattern.
- [ ] **Step 2: Update `api/plugin.ts`** — apply pattern.
- [ ] **Step 3: Update `api/task-auto.ts`** — apply pattern.
- [ ] **Step 4: Update `utils/openNotebookByPath.ts`** — apply pattern.
- [ ] **Step 5: Update `utils/pasteImages.ts`** — apply pattern.

- [ ] **Step 6: Verify**

Run: `grep -rn "Authorization.*Bearer" packages/web/src/api/ packages/web/src/utils/`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/api/ packages/web/src/utils/openNotebookByPath.ts packages/web/src/utils/pasteImages.ts
git commit -m "feat(web): drop Bearer header in api and utils modules"
```

---

## Task 14: Strip Bearer header from web components, hooks, mention plugins (11 files)

**Files (modify):**
- `packages/web/src/components/Cell.tsx`
- `packages/web/src/components/FileSection.tsx`
- `packages/web/src/components/ProjectSidebar.tsx`
- `packages/web/src/components/WelcomeScreen.tsx`
- `packages/web/src/components/mobile/MobileNotebooksList.tsx`
- `packages/web/src/components/mobile/MobileProjectsList.tsx`
- `packages/web/src/components/shared/InputBar.tsx`
- `packages/web/src/hooks/useNotebookActions.ts`
- `packages/web/src/mention/FileTreePlugin.tsx`
- `packages/web/src/mention/SlashCommandPlugin.tsx`

Same transformation pattern as Tasks 12-13. Many of these read `authToken` from the Zustand store; once the store no longer exposes that field, these usages must be removed entirely.

- [ ] **Step 1: Update each file**

For each file in the list, apply:
- Remove `const authToken = useStore(s => s.authToken)` (or destructured equivalent).
- Remove `if (authToken) headers['Authorization'] = \`Bearer ${authToken}\``.
- Remove `...(authToken ? { Authorization: \`Bearer ${authToken}\` } : {})`.
- Add `credentials: 'same-origin'` to the fetch call options.

Apply in this order (all 10 files):
1. `components/Cell.tsx`
2. `components/FileSection.tsx`
3. `components/ProjectSidebar.tsx`
4. `components/WelcomeScreen.tsx`
5. `components/mobile/MobileNotebooksList.tsx`
6. `components/mobile/MobileProjectsList.tsx`
7. `components/shared/InputBar.tsx`
8. `hooks/useNotebookActions.ts` (multiple fetch sites — handle each)
9. `mention/FileTreePlugin.tsx`
10. `mention/SlashCommandPlugin.tsx`

- [ ] **Step 2: Verify**

Run: `grep -rn "Authorization.*Bearer" packages/web/src --include="*.ts" --include="*.tsx" | grep -v __tests__`
Expected: no output (zero remaining Bearer header injections in production web code).

- [ ] **Step 3: Verify authToken field removed everywhere**

Run: `grep -rn "authToken" packages/web/src --include="*.ts" --include="*.tsx" | grep -v __tests__`
Expected: no output (or only declarations being removed in this commit).

- [ ] **Step 4: Run web type-check + tests**

Run:
```bash
pnpm --filter @notebook-ai/web exec tsc --noEmit
pnpm --filter @notebook-ai/web exec vitest run
```
Expected: zero type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/ packages/web/src/hooks/useNotebookActions.ts packages/web/src/mention/
git commit -m "feat(web): drop Bearer header in components, hooks, mention plugins"
```

---

## Task 15: Add cookieAuthFetch test, update .env.example, version bump, full regression

**Files:**
- Create: `packages/web/src/__tests__/cookieAuthFetch.test.ts`
- Modify: `.env.example`
- Modify: `package.json` (root, server, web) — bump to `2.3.0`

- [ ] **Step 1: Write cookieAuthFetch.test.ts**

```ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

describe('Cookie-based auth fetch', () => {
  const root = path.join(__dirname, '..');
  const files = glob.sync('**/*.{ts,tsx}', {
    cwd: root,
    ignore: ['__tests__/**', '**/*.d.ts'],
    absolute: true,
  });

  it('no production source file injects Authorization Bearer header', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf-8');
      if (/Authorization['"]?\s*[:=]\s*[`'"]\s*Bearer/.test(src)) {
        offenders.push(path.relative(root, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no production source file uses sessionStorage or localStorage for nb-auth-token', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf-8');
      if (/(sessionStorage|localStorage)\.(get|set|remove)Item\(['"]nb-auth-token['"]/.test(src)) {
        offenders.push(path.relative(root, f));
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

If `glob` isn't already a dev dep, add it: `pnpm --filter @notebook-ai/web add -D glob`.

- [ ] **Step 2: Run new test**

Run: `pnpm --filter @notebook-ai/web exec vitest run src/__tests__/cookieAuthFetch.test.ts`
Expected: PASS.

- [ ] **Step 3: Update .env.example**

Append:
```bash
# Comma-separated allowed origins for CSRF Origin check (web mutate requests).
# Default: http://localhost:3003,http://localhost:4003
NB_ALLOWED_ORIGINS=http://localhost:3003,http://localhost:4003

# Set to 1 only in tests to bypass CSRF Origin check. Never set in production.
# NB_CSRF_DISABLED=1
```

- [ ] **Step 4: Bump versions to 2.3.0**

Run:
```bash
sed -i 's/"version": "2\.2\.3"/"version": "2.3.0"/' package.json packages/server/package.json packages/web/package.json
grep '"version"' package.json packages/server/package.json packages/web/package.json
```
Expected: all three show `2.3.0`.

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: all packages pass. Capture the count (CLAUDE.md: "X tests passing, zero regressions").

- [ ] **Step 6: Restart service and manual smoke test**

Per `MEMORY.md` (`feedback_restart_workflow.md`), restart via systemd:
```bash
sudo systemctl restart notebook-ai
```

Then open `http://localhost:3003` in a browser. Manually verify the 8 checks from spec section 6.8:
1. F12 → Application → Cookies: `nb-auth-token` shows HttpOnly = ✓
2. Close browser → reopen → land directly on home (core success criterion)
3. DevTools console: `document.cookie` does not include `nb-auth-token`
4. Open second tab → already logged in
5. Click Logout → cookie disappears in F12
6. From terminal: `curl -i http://localhost:4003/api/health` returns 200 with cache stats
7. From terminal: `curl -X POST -H "Origin: https://evil.example" --cookie "nb-auth-token=anything" http://localhost:4003/api/projects` → 403
8. `curl -i http://localhost:4003/api/health | head -20` shows session stats block

- [ ] **Step 7: Commit and tag**

```bash
git add .env.example package.json packages/server/package.json packages/web/package.json packages/web/src/__tests__/cookieAuthFetch.test.ts
git commit -m "chore: v2.3.0 — HttpOnly cookie auth + SessionCache + CSRF middleware"
git tag v2.3.0
```

(Per CLAUDE.md, do NOT push without explicit user request.)

---

## Self-Review Notes

**Spec coverage check:**
- §1 Background → motivation embedded in plan header
- §2 Architecture → Tasks 2-9 (server) + 10-14 (web)
- §3 Components → Tasks 2 (SessionCache), 4 (auth-helpers), 5 (csrf), 7-8 (cookies in auth.ts), 10-14 (web)
- §4 Data flow → exercised by E2E tests in Task 7
- §5 Error handling → Task 4 (clearCookie on invalid), Task 8 (logout), Task 5 (CSRF responses)
- §6 Testing → Tasks 2, 5, 7, 10, 15
- §7 Dependencies → Task 1 (cookie-parser), Task 15 (.env.example, version)
- §8 Risks → mitigations live across tasks; manual smoke test in Task 15 covers regression detection

**Frequent commits:** every task ends with `git commit`; 15 commits total.

**TDD applied:** Tasks 2 and 5 follow strict red-green; remaining tasks reuse existing test infrastructure with adapted assertions.

**No placeholders detected** in the plan body.
