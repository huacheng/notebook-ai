/**
 * D1/D6 tests: Auth module constants and handleAuthStatus consistency
 */
import { describe, it, expect } from 'vitest';
import {
  authEnabled,
  BASE_LOCKOUT_MS,
  BASE_LOCKOUT_SEC,
  MAX_LOCKOUT_MS,
} from '../auth.js';

describe('auth constants - D6', () => {
  it('BASE_LOCKOUT_MS should be 60 seconds', () => {
    expect(BASE_LOCKOUT_MS).toBe(60_000);
  });

  it('BASE_LOCKOUT_SEC should equal BASE_LOCKOUT_MS / 1000', () => {
    expect(BASE_LOCKOUT_SEC).toBe(BASE_LOCKOUT_MS / 1000);
  });

  it('MAX_LOCKOUT_MS should be 30 minutes', () => {
    expect(MAX_LOCKOUT_MS).toBe(30 * 60_000);
  });

  it('authEnabled should be exported and boolean', () => {
    expect(typeof authEnabled).toBe('boolean');
  });
});

describe('MIN_PASSWORD_LENGTH - D6', () => {
  // This test documents that password length should be a constant
  // Currently hardcoded as 8 in handleRegister
  it('should export MIN_PASSWORD_LENGTH constant', async () => {
    // Import dynamically to check if constant exists
    const authModule = await import('../auth.js');
    expect(typeof (authModule as Record<string, unknown>).MIN_PASSWORD_LENGTH).toBe('number');
    expect((authModule as Record<string, unknown>).MIN_PASSWORD_LENGTH).toBe(8);
  });
});
