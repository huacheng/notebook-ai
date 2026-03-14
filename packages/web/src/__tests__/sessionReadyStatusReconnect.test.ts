import { describe, test, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Regression test: sessionReadyStatus should be cleared on disconnect
 *
 * BUG: After disconnect, sessionReadyStatus still has 'ready' entries.
 * On reconnect, subscribeToSession checks `if (!sessionReadyStatus[sessionId])`
 * which is FALSE (still 'ready'), so status is not reset to 'subscribing'.
 * This causes the spinner not to show during reconnection.
 *
 * FIX: Clear sessionReadyStatus in ws.onclose handler.
 */
describe('sessionReadyStatus cleared on disconnect', () => {
  const wsSliceSrc = fs.readFileSync(
    path.join(__dirname, '../store/wsSlice.ts'),
    'utf-8'
  );

  test('ws.onclose should clear sessionReadyStatus', () => {
    // Find the onclose handler and check it clears sessionReadyStatus
    const oncloseBlock = wsSliceSrc.match(/ws\.onclose\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\n    \};/);
    expect(oncloseBlock).toBeTruthy();

    const block = oncloseBlock![0];

    // The fix: sessionReadyStatus: {} should be in the set() call
    expect(block).toContain('sessionReadyStatus: {}');
  });

  test('sessionReadyStatus should be reset so spinner shows during reconnect', () => {
    // The onclose handler should include sessionReadyStatus in the cleanup
    const hasCleanup = wsSliceSrc.includes('sessionReadyStatus: {}') &&
      wsSliceSrc.includes('wsStatus: \'disconnected\'');

    expect(hasCleanup).toBe(true);
  });
});
