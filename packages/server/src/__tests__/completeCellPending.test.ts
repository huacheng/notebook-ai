import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../session.ts'),
  'utf-8',
);

/**
 * P1-2: completeCell defers git commit + autoSave via setTimeout.
 * On shutdown, these promises are lost. Must track pending work and await in closeSession.
 */
describe('completeCell pending work tracking (P1-2)', () => {
  it('should track pending post-completion work on the session', () => {
    // Session interface should have a field for pending post-completion
    expect(src).toMatch(/_pendingPostComplete|_pendingCompletion/);
  });

  it('should await pending work in closeSession', () => {
    const closeBlock = src.slice(
      src.indexOf('closeSession('),
      src.indexOf('closeAllSessions'),
    );
    expect(closeBlock).toMatch(/_pendingPostComplete|_pendingCompletion/);
  });
});
