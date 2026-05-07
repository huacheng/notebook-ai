import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const sliceSrc = readFileSync(
  path.resolve(__dirname, '../store/authSlice.ts'),
  'utf-8',
);

describe('Auth token storage', () => {
  it('does not persist auth token in localStorage', () => {
    expect(sliceSrc).not.toContain("localStorage.setItem('nb-auth-token'");
    expect(sliceSrc).not.toContain("localStorage.getItem('nb-auth-token')");
  });

  it('does not persist auth token in sessionStorage (now HttpOnly cookie)', () => {
    expect(sliceSrc).not.toContain("sessionStorage.setItem('nb-auth-token'");
    expect(sliceSrc).not.toContain("sessionStorage.getItem('nb-auth-token')");
  });
});
