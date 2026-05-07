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
    cache.create('u4', 'd@x');
    db.getSessionToken.mockReturnValueOnce(null);
    expect(cache.validate(t1)).toBeNull();
    expect(cache.validate(t2)?.userId).toBe('u2');
    expect(cache.validate(t3)?.userId).toBe('u3');
    expect(cache.getStats().evictions).toBe(1);
  });

  it('LRU touch on validate prevents eviction', () => {
    const t1 = cache.create('u1', 'a@x');
    const t2 = cache.create('u2', 'b@x');
    cache.create('u3', 'c@x');
    cache.validate(t1);
    cache.create('u4', 'd@x');
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
    cache.validate(t);
    db.getSessionToken.mockReturnValueOnce(null);
    cache.validate('bad');
    cache.validate('bad');
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
