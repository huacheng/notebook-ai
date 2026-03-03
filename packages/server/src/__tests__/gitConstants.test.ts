/**
 * D6 tests: git module constants
 */
import { describe, it, expect } from 'vitest';

describe('git constants - D6', () => {
  it('should export GIT_EMPTY_TREE_HASH constant', async () => {
    const module = await import('../git.js');
    expect(typeof (module as Record<string, unknown>).GIT_EMPTY_TREE_HASH).toBe('string');
    // SHA-1 hash is 40 hex characters
    expect((module as Record<string, unknown>).GIT_EMPTY_TREE_HASH).toMatch(/^[a-f0-9]{40}$/);
  });

  it('should export DEFAULT_GIT_LOG_COUNT constant', async () => {
    const module = await import('../git.js');
    expect(typeof (module as Record<string, unknown>).DEFAULT_GIT_LOG_COUNT).toBe('number');
    expect((module as Record<string, unknown>).DEFAULT_GIT_LOG_COUNT).toBe(20);
  });

  it('should export DEFAULT_GIT_USER_EMAIL constant', async () => {
    const module = await import('../git.js');
    expect(typeof (module as Record<string, unknown>).DEFAULT_GIT_USER_EMAIL).toBe('string');
  });

  it('should export DEFAULT_GIT_USER_NAME constant', async () => {
    const module = await import('../git.js');
    expect(typeof (module as Record<string, unknown>).DEFAULT_GIT_USER_NAME).toBe('string');
  });
});
