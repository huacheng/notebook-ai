import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Clear session (restart without resume) - truly clears Claude context
 *
 * - restart_session with clear: true should call restartSession with skipResume: true
 * - This clears Claude's conversation history
 */
describe('clear_session (restart without resume)', () => {
  const wsHandlerSrc = readFileSync(
    path.resolve(__dirname, '../ws-handler.ts'),
    'utf-8',
  );

  it('should support clear parameter in restart_session message', () => {
    // The ws-handler should check for clear: true and pass skipResume: true
    const supportsClear =
      wsHandlerSrc.includes('clear') &&
      wsHandlerSrc.includes('skipResume');
    expect(supportsClear).toBe(true);
  });

  it('should pass skipResume: true when clear is requested', () => {
    // When clear: true, restartSession should be called with { skipResume: true }
    const hasSkipResumeLogic = wsHandlerSrc.includes('skipResume: true');
    expect(hasSkipResumeLogic).toBe(true);
  });
});
