import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * TDD tests for email-based registration (replacing username).
 */

const authPath = path.resolve(__dirname, '../auth.ts');

describe('Email-based Registration', () => {
  let src: string;

  beforeAll(() => {
    src = readFileSync(authPath, 'utf-8');
  });

  // ── Registration should use email ──────────────────────────────────────────

  it('handleRegister should accept email instead of username', () => {
    const start = src.indexOf('function handleRegister');
    const end = src.indexOf('\n// ──', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 3000);

    expect(block).toContain('email');
    expect(block).not.toMatch(/username.*password/); // Should not have username
  });

  it('handleRegister should validate email format', () => {
    const start = src.indexOf('function handleRegister');
    const end = src.indexOf('\n// ──', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 3000);

    // Should check for @ symbol or use regex for email validation
    expect(block).toMatch(/@|email.*valid|isValidEmail/i);
  });

  // ── Login should use email ─────────────────────────────────────────────────

  it('handleLogin should accept email instead of username', () => {
    const start = src.indexOf('function handleLogin');
    const end = src.indexOf('\n// ──', start + 1);
    const block = src.slice(start, end > 0 ? end : start + 2000);

    expect(block).toContain('email');
  });

  // ── Session token should store email ───────────────────────────────────────

  it('SessionToken interface should have email field', () => {
    expect(src).toMatch(/interface\s+SessionToken[\s\S]*?email\s*:/);
  });

  it('createSessionToken should accept email parameter', () => {
    const start = src.indexOf('function createSessionToken');
    const end = src.indexOf('\n}', start + 50);
    const block = src.slice(start, end > 0 ? end + 1 : start + 500);

    expect(block).toContain('email');
  });

  // ── UserRow should have email instead of username ──────────────────────────

  it('UserRow interface should have email field', () => {
    expect(src).toMatch(/interface\s+UserRow[\s\S]*?email\s*:/);
  });
});
