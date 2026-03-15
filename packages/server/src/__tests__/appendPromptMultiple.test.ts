import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression test: appendPrompt deferred completion
 *
 * When _pendingAppends > 0, completeCell should ALWAYS defer (return)
 * after decrementing — even when counter reaches 0. The first result
 * is for the ORIGINAL prompt, not the appended one. The appended prompt's
 * result will call completeCell again with counter = 0 → complete normally.
 *
 * Correct code:
 *   if (session._pendingAppends > 0 && !isError) {
 *     session._pendingAppends--;
 *     return;  // always defer — append result hasn't arrived yet
 *   }
 */
describe('appendPrompt multiple prompts completion', () => {
  const sessionSrc = fs.readFileSync(
    path.join(__dirname, '../session.ts'),
    'utf-8'
  );

  it('completeCell should always defer when _pendingAppends > 0 (even after decrement to 0)', () => {
    // The block: if _pendingAppends > 0 → decrement → return (unconditionally)
    const block = sessionSrc.match(
      /if\s*\(session\._pendingAppends\s*>\s*0[\s\S]*?return;\s*\}/
    );
    expect(block).toBeTruthy();

    // Should NOT have a secondary check "if (_pendingAppends > 0)" before return
    // That was the old bug — it would fall through to complete when counter hit 0
    const oldBugPattern = /session\._pendingAppends--;\s*if\s*\(session\._pendingAppends\s*>\s*0\)\s*\{/;
    expect(oldBugPattern.test(block![0])).toBe(false);
  });

  it('should decrement and unconditionally return', () => {
    // Correct pattern: decrement then return (no conditional)
    const correctPattern = /session\._pendingAppends--;\s*(?:console\.log\([^)]+\);\s*)?return;/;
    expect(correctPattern.test(sessionSrc)).toBe(true);
  });
});
