import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../store/authSlice.ts'),
  'utf-8',
);

/**
 * P1-7: authToken stored in localStorage is accessible to any XSS.
 * sessionStorage limits exposure to the current tab and clears on close.
 */
describe('authToken storage (P1-7)', () => {
  it('should not use localStorage for auth token', () => {
    expect(src).not.toContain("localStorage.getItem('nb-auth-token')");
    expect(src).not.toContain("localStorage.setItem('nb-auth-token'");
    expect(src).not.toContain("localStorage.removeItem('nb-auth-token')");
  });

  it('should use sessionStorage for auth token', () => {
    expect(src).toContain("sessionStorage");
  });
});
