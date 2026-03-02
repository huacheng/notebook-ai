import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../auth.ts'),
  'utf-8',
);

/**
 * P1-4: authMiddleware bypass list is fragile — /verify and /ws-ticket
 * do their own internal auth but also go through the middleware, causing
 * redundant double-validation. All self-authenticating endpoints should
 * be explicitly listed in the bypass set.
 */
describe('authMiddleware bypass list (P1-4)', () => {
  it('should bypass /api/auth/verify (self-authenticating)', () => {
    const middlewareFn = src.slice(
      src.indexOf('function authMiddleware'),
      src.indexOf('\n}', src.indexOf('function authMiddleware')) + 2,
    );
    expect(middlewareFn).toContain('/api/auth/verify');
  });

  it('should bypass /api/auth/ws-ticket (self-authenticating)', () => {
    const middlewareFn = src.slice(
      src.indexOf('function authMiddleware'),
      src.indexOf('\n}', src.indexOf('function authMiddleware')) + 2,
    );
    expect(middlewareFn).toContain('/api/auth/ws-ticket');
  });
});
