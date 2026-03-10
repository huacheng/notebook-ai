/**
 * Test: Session tokens should be persisted to SQLite database
 * so they survive server restarts.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const authSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../auth.ts'), 'utf-8');

const dbSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../db.ts'), 'utf-8');

describe('Session token persistence', () => {
  it('db.ts should have a session_tokens table', () => {
    const src = dbSrc();
    expect(src).toContain('session_tokens');
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS session_tokens/);
  });

  it('auth.ts should persist tokens to database on create', () => {
    const src = authSrc();
    // createSessionToken should write to db, not just in-memory Map
    expect(src).toMatch(/insertToken|upsertSessionToken|saveSessionToken/);
  });

  it('auth.ts should load tokens from database on validate', () => {
    const src = authSrc();
    // validateSessionToken should fall back to db lookup
    expect(src).toMatch(/getSessionToken|loadSessionToken|findToken/);
  });

  it('auth.ts should delete tokens from database on revoke', () => {
    const src = authSrc();
    // revokeSessionToken should also delete from db
    expect(src).toMatch(/deleteSessionToken|removeToken/);
  });
});
