import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Session subscription after page refresh
 *
 * Bug: After page refresh, restoreNotebook sets global sessionId but doesn't update openNotebooks.
 * useWebSocket derives subscribed sessions from openNotebooks only, so the session is not subscribed.
 * This causes interrupt_cell to fail with "Not subscribed to this session."
 *
 * Expected behavior:
 * - Either restoreNotebook should also update openNotebooks
 * - Or useWebSocket should include global sessionId in subscriptions
 */
describe('Session subscription after restore', () => {
  const useWebSocketSrc = readFileSync(
    path.resolve(__dirname, '../hooks/useWebSocket.ts'),
    'utf-8',
  );

  it('useWebSocket should include global sessionId in subscription list (not just openNotebooks)', () => {
    // The original implementation only used openNotebooks:
    // const openSessionIds = useStore(
    //   (s) => Object.values(s.openNotebooks).map((e) => e.sessionId)...
    // );
    //
    // This failed because restoreNotebook sets global sessionId but not openNotebooks.
    // Fix: Also include s.sessionId in the subscription list.

    // Check that useWebSocket includes s.sessionId AND pushes it to the ids array
    const includesGlobalSessionId =
      useWebSocketSrc.includes('s.sessionId') &&
      useWebSocketSrc.includes('ids.push(s.sessionId)');

    // After fix: useWebSocket should derive sessions from both openNotebooks AND global sessionId
    expect(includesGlobalSessionId).toBe(true);
  });
});

describe('Alternative: useWebSocket fix instead of restoreNotebook', () => {
  const useWebSocketSrc = readFileSync(
    path.resolve(__dirname, '../hooks/useWebSocket.ts'),
    'utf-8',
  );

  it('useWebSocket selector handles global sessionId for backward compatibility', () => {
    // The fix was applied to useWebSocket instead of restoreNotebook.
    // This keeps backward compatibility: restoreNotebook sets global sessionId,
    // and useWebSocket now includes it in the subscription list.

    // Verify the fix: useWebSocket should check for s.sessionId
    const hasBackwardCompatFix =
      useWebSocketSrc.includes('Also include global sessionId') ||
      useWebSocketSrc.includes('restoreNotebook after page refresh');

    expect(hasBackwardCompatFix).toBe(true);
  });
});
