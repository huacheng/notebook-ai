import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression test: multiple appendPrompt should still allow cell completion
 *
 * BUG: When _pendingAppends > 0, completeCell decrements and returns.
 * But when _pendingAppends becomes 0 after decrement, it should NOT return
 * but instead continue to complete the cell.
 *
 * Current buggy code:
 *   if (session._pendingAppends > 0 && !isError) {
 *     session._pendingAppends--;
 *     return;  // BUG: returns even when _pendingAppends just became 0
 *   }
 *
 * Fix: Only return if _pendingAppends is STILL > 0 after decrement
 */
describe('appendPrompt multiple prompts completion', () => {
  const sessionSrc = fs.readFileSync(
    path.join(__dirname, '../session.ts'),
    'utf-8'
  );

  it('completeCell should continue (not return) when _pendingAppends decrements to 0', () => {
    // Extract the completeCell pendingAppends handling block
    const pendingAppendsBlock = sessionSrc.match(
      /if\s*\(session\._pendingAppends\s*>\s*0[\s\S]*?return;[\s\S]*?\}/
    );
    expect(pendingAppendsBlock).toBeTruthy();

    const block = pendingAppendsBlock![0];

    // The fix: after decrementing, should check if _pendingAppends is STILL > 0
    // Pattern: decrement, then check > 0 before returning
    // e.g., session._pendingAppends--; if (session._pendingAppends > 0) { return; }
    // or: if (--session._pendingAppends > 0) { return; }

    // The block should NOT have a pattern where return immediately follows decrement
    // without a secondary check for > 0
    const buggyPattern = /session\._pendingAppends--;\s*(?:console\.log\([^)]+\);\s*)?return;/;
    const hasBug = buggyPattern.test(block);

    // This test should FAIL on current buggy code
    expect(hasBug).toBe(false);
  });

  it('should only return when _pendingAppends remains > 0 after decrement', () => {
    // Look for the correct pattern: decrement then conditionally return
    const correctPattern = /session\._pendingAppends--[\s\S]*?if\s*\(session\._pendingAppends\s*>\s*0\)[\s\S]*?return/;
    const hasCorrectPattern = correctPattern.test(sessionSrc);

    expect(hasCorrectPattern).toBe(true);
  });
});
