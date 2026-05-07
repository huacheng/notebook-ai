/**
 * Test: Session tokens should be persisted to SQLite database
 * so they survive server restarts.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionCacheSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session-cache.ts'), 'utf-8');

const dbSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../db.ts'), 'utf-8');

describe('Session token persistence', () => {
  it('db.ts should have a session_tokens table', () => {
    const src = dbSrc();
    expect(src).toContain('session_tokens');
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS session_tokens/);
  });

  it('auth.ts should persist tokens to database on create', () => {
    // Since Task 3, persistence is delegated to SessionCache.
    // The call to upsertSessionToken lives in session-cache.ts.
    const cacheSrc = sessionCacheSrc();
    expect(cacheSrc).toMatch(/insertToken|upsertSessionToken|saveSessionToken/);
  });

  it('auth.ts should load tokens from database on validate', () => {
    // Since Task 3, DB lookup is delegated to SessionCache.
    const cacheSrc = sessionCacheSrc();
    expect(cacheSrc).toMatch(/getSessionToken|loadSessionToken|findToken/);
  });

  it('auth.ts should delete tokens from database on revoke', () => {
    // Since Task 3, DB deletion is delegated to SessionCache.
    const cacheSrc = sessionCacheSrc();
    expect(cacheSrc).toMatch(/deleteSessionToken|removeToken/);
  });
});
