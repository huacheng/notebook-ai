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
  hitRate: number;
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
      const db = this.getDb();
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
        try { db.deleteSessionToken(token); } catch { /* ignore */ }
      }

      const row = db.getSessionToken(token);
      if (!row) {
        this.markNegative(token);
        this.stats.misses++;
        return null;
      }
      if (Date.now() >= row.expiresAt) {
        try { db.deleteSessionToken(token); } catch { /* ignore */ }
        this.markNegative(token);
        this.stats.misses++;
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
    // Trade-off: async DB write keeps login latency low; if the process crashes
    // between cache.set and the timer firing, the token is unreachable after restart.
    setImmediate(() => {
      try { this.getDb().upsertSessionToken(token, userId, email, expiresAt); }
      catch (err) { console.error('[sessionCache] db upsert failed:', err); }
    });
    return token;
  }

  revoke(token: string): void {
    this.cache.delete(token);
    this.negCache.delete(token);
    try { this.getDb().deleteSessionToken(token); }
    catch (err) { console.error('[sessionCache] revoke db delete failed:', err); }
  }

  getStats(): SessionCacheStats {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total === 0 ? 0 : this.stats.hits / total;
    return {
      ...this.stats,
      size: this.cache.size,
      negSize: this.negCache.size,
      hitRate,
    };
  }

  dispose(): void {
    clearInterval(this.sweepTimer);
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
    while (this.negCache.size > this.maxSize) {
      const oldest = this.negCache.keys().next().value;
      if (oldest === undefined) break;
      this.negCache.delete(oldest);
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
