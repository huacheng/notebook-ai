import { describe, it, expect } from 'vitest';
import { GIT_DEFAULT_ALL_BRANCHES } from '../utils/gitDefaults';

describe('GitHistoryPanel defaults', () => {
  it('should default to showing all branches', () => {
    expect(GIT_DEFAULT_ALL_BRANCHES).toBe(true);
  });
});
