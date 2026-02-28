import { describe, it, expect } from 'vitest';
import { makeFetchGuard } from '../utils/fetchGuard';

describe('makeFetchGuard', () => {
  it('new fetch increments ID', () => {
    const guard = makeFetchGuard();
    const id1 = guard.next();
    const id2 = guard.next();
    expect(id2).toBeGreaterThan(id1);
  });

  it('isCurrent returns false for stale ID', () => {
    const guard = makeFetchGuard();
    const id1 = guard.next();
    guard.next(); // new fetch supersedes id1
    expect(guard.isCurrent(id1)).toBe(false);
  });

  it('isCurrent returns true for latest ID', () => {
    const guard = makeFetchGuard();
    guard.next();
    const id2 = guard.next();
    expect(guard.isCurrent(id2)).toBe(true);
  });
});
