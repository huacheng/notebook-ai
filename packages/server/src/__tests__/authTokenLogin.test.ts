import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const AUTH_SRC = readFileSync(
  path.resolve(__dirname, '../auth.ts'),
  'utf-8',
);

describe('Auth-token login mode', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env['NB_AUTH_TOKEN'] = 'test-secret-token-abc123';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ── Source-level structural tests ─────────────────────────────────────────

  it('auth.ts should export handleTokenLogin function', () => {
    expect(AUTH_SRC).toContain('export async function handleTokenLogin');
  });

  it('auth.ts should export authMode variable', () => {
    expect(AUTH_SRC).toMatch(/export const authMode/);
  });

  it('handleAuthStatus should return authMode in response', () => {
    // The handleAuthStatus function should include authMode in its json response
    const statusFnStart = AUTH_SRC.indexOf('function handleAuthStatus');
    const statusFnEnd = AUTH_SRC.indexOf('\n}', statusFnStart) + 2;
    const statusFn = AUTH_SRC.slice(statusFnStart, statusFnEnd);
    expect(statusFn).toContain('authMode');
  });

  it('handleTokenLogin should use timingSafeEqual for token comparison', () => {
    const fnStart = AUTH_SRC.indexOf('function handleTokenLogin');
    const fnEnd = AUTH_SRC.indexOf('\n}', fnStart) + 2;
    const fn = AUTH_SRC.slice(fnStart, fnEnd);
    expect(fn).toContain('timingSafeEqual');
  });

  it('handleTokenLogin should call recordFailure on invalid token', () => {
    const fnStart = AUTH_SRC.indexOf('function handleTokenLogin');
    const fnEnd = AUTH_SRC.indexOf('\n}', fnStart) + 2;
    const fn = AUTH_SRC.slice(fnStart, fnEnd);
    expect(fn).toContain('recordFailure');
  });

  it('handleTokenLogin should call checkRateLimit', () => {
    const fnStart = AUTH_SRC.indexOf('function handleTokenLogin');
    const fnEnd = AUTH_SRC.indexOf('\n}', fnStart) + 2;
    const fn = AUTH_SRC.slice(fnStart, fnEnd);
    expect(fn).toContain('checkRateLimit');
  });

  it('handleTokenLogin should reject token shorter than 24 chars', () => {
    const fnStart = AUTH_SRC.indexOf('function handleTokenLogin');
    const fnEnd = AUTH_SRC.indexOf('\n}', fnStart) + 2;
    const fn = AUTH_SRC.slice(fnStart, fnEnd);
    expect(fn).toContain('.length < 24');
  });

  it('handleTokenLogin should create session token on success', () => {
    const fnStart = AUTH_SRC.indexOf('function handleTokenLogin');
    const fnEnd = AUTH_SRC.indexOf('\n}', fnStart) + 2;
    const fn = AUTH_SRC.slice(fnStart, fnEnd);
    expect(fn).toContain('createSessionToken');
  });

  it('authMiddleware bypass list should include /api/auth/login-token', () => {
    const mwStart = AUTH_SRC.indexOf('function authMiddleware');
    const mwEnd = AUTH_SRC.indexOf('\n}', mwStart) + 2;
    const mw = AUTH_SRC.slice(mwStart, mwEnd);
    expect(mw).toContain('/api/auth/login-token');
  });
});

describe('Auth-token mode — routes', () => {
  const ROUTES_SRC = readFileSync(
    path.resolve(__dirname, '../routes/auth.ts'),
    'utf-8',
  );

  it('should register POST /login-token route', () => {
    expect(ROUTES_SRC).toContain("'/login-token'");
    expect(ROUTES_SRC).toContain('handleTokenLogin');
  });
});
