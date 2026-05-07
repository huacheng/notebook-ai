import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * TDD tests for email/password login (replacing shared token auth).
 *
 * Requirements:
 * 1. Login accepts email + password instead of shared token
 * 2. Session tokens are generated on successful login
 * 3. Session tokens are used for API authentication
 * 4. No more NB_AUTH_TOKEN environment variable dependency
 */

const authPath = path.resolve(__dirname, '../auth.ts');

describe('Email/Password Login - Auth Module', () => {
  let src: string;

  beforeAll(() => {
    src = readFileSync(authPath, 'utf-8');
  });

  // ── Login should accept email/password ──────────────────────────────────

  it('handleLogin should accept email and password', () => {
    const start = src.indexOf('function handleLogin');
    const end = src.indexOf('\n// ──', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 2000);

    // Should destructure email and password from body
    expect(block).toMatch(/email.*password|password.*email/);
  });

  it('handleLogin should NOT reference NB_AUTH_TOKEN', () => {
    const start = src.indexOf('function handleLogin');
    const end = src.indexOf('\n// ──', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 2000);

    expect(block).not.toContain('NB_AUTH_TOKEN');
  });

  it('handleLogin should verify password using verifyPassword', () => {
    const start = src.indexOf('function handleLogin');
    const end = src.indexOf('\n// ──', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 2000);

    expect(block).toContain('verifyPassword');
  });

  it('handleLogin should return session token on success', () => {
    const start = src.indexOf('function handleLogin');
    const end = src.indexOf('\n// ──', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 2000);

    // Should return a token/sessionToken in response
    expect(block).toMatch(/token|sessionToken/i);
  });

  // ── Session token management ───────────────────────────────────────────────

  it('should have session tokens storage', () => {
    // sessionTokens (legacy in-memory map) OR sessionCache (delegated SessionCache)
    expect(src).toMatch(/sessionTokens|activeSessions|sessionCache/);
  });

  it('should have createSessionToken function', () => {
    expect(src).toMatch(/function\s+createSessionToken|createSessionToken\s*=/);
  });

  it('should have validateSessionToken function', () => {
    expect(src).toMatch(/function\s+validateSessionToken|validateSessionToken\s*=/);
  });

  // ── Middleware should use session tokens ───────────────────────────────────

  it('authMiddleware should NOT reference NB_AUTH_TOKEN', () => {
    const start = src.indexOf('function authMiddleware');
    const end = src.indexOf('\n}', start + 50);
    const block = src.slice(start, end > 0 ? end + 1 : start + 1500);

    expect(block).not.toContain('NB_AUTH_TOKEN');
  });

  it('authMiddleware should use session token validation (via requireAuth or validateSessionToken)', () => {
    const start = src.indexOf('function authMiddleware');
    const end = src.indexOf('\n}', start + 50);
    const block = src.slice(start, end > 0 ? end + 1 : start + 1500);

    // After Task 4 refactor, validation is delegated to requireAuth (auth-helpers.ts)
    expect(block).toMatch(/validateSessionToken|requireAuth/);
  });

  // ── Verify endpoint should use session tokens ──────────────────────────────

  it('handleVerify should use session token validation (via requireAuth or validateSessionToken)', () => {
    const start = src.indexOf('function handleVerify');
    const end = src.indexOf('\n// ──', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 1500);

    // After Task 4 refactor, validation is delegated to requireAuth (auth-helpers.ts)
    expect(block).toMatch(/validateSessionToken|requireAuth/);
  });

  // ── WS ticket should use session tokens ────────────────────────────────────

  it('handleWsTicket should use session token validation (via requireAuth or validateSessionToken)', () => {
    const start = src.indexOf('function handleWsTicket');
    const end = src.indexOf('\n// ──', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 1500);

    // After Task 4 refactor, validation is delegated to requireAuth (auth-helpers.ts)
    expect(block).toMatch(/validateSessionToken|requireAuth/);
  });

  // ── Auth status should always return authEnabled: true ─────────────────────

  it('handleAuthStatus should return authEnabled: true (always enabled)', () => {
    const start = src.indexOf('function handleAuthStatus');
    const end = src.indexOf('\n}', start + 50);
    const block = src.slice(start, end > 0 ? end + 1 : start + 500);

    // Should return { authEnabled: true } since user auth is always required
    expect(block).toMatch(/authEnabled:\s*true/);
  });

  // ── No more NB_AUTH_TOKEN at module level ──────────────────────────────────

  it('should NOT have NB_AUTH_TOKEN constant', () => {
    // Should not have the old shared token constant
    expect(src).not.toMatch(/const\s+NB_AUTH_TOKEN\s*=/);
  });
});
