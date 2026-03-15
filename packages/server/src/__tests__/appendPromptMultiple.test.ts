import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression test: appendPrompt completion behavior
 *
 * Claude processes appended prompts within the same conversation turn and
 * sends only ONE result for the entire turn. The _pendingAppends counter
 * was removed because:
 * 1. It incorrectly assumed each append triggers a separate result
 * 2. This caused cells to never complete when appends were used
 *
 * Correct behavior: when result arrives, complete the cell immediately.
 * No defer logic needed.
 */
describe('appendPrompt completion behavior', () => {
  const sessionSrc = fs.readFileSync(
    path.join(__dirname, '../session.ts'),
    'utf-8'
  );

  it('should NOT have _pendingAppends field (removed)', () => {
    // The field was removed because it caused incorrect defer behavior
    expect(sessionSrc).not.toMatch(/_pendingAppends:\s*number/);
  });

  it('completeCell should NOT have defer logic based on pending appends', () => {
    // The old buggy pattern: defer and return when _pendingAppends > 0
    const oldBugPattern = /if\s*\(session\._pendingAppends\s*>\s*0[\s\S]*?return;\s*\}/;
    expect(oldBugPattern.test(sessionSrc)).toBe(false);
  });
});
