/**
 * D6 tests: Database module constants
 */
import { describe, it, expect } from 'vitest';

describe('database constants - D6', () => {
  it('should export DEFAULT_ANNOTATION_MAX_AGE_DAYS constant', async () => {
    const dbModule = await import('../db.js');
    expect(typeof (dbModule as Record<string, unknown>).DEFAULT_ANNOTATION_MAX_AGE_DAYS).toBe('number');
    expect((dbModule as Record<string, unknown>).DEFAULT_ANNOTATION_MAX_AGE_DAYS).toBe(7);
  });
});
