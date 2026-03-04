import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * cell_load should work without strict subscription check
 *
 * Problem: After page refresh, cell_load requests may arrive before the WS subscribe message
 * is processed by the server (race condition). This causes cells to fail loading with spinner.
 *
 * Solution: cell_load is a read-only operation. If the session exists and belongs to the
 * current user, allow the request without requiring explicit subscription.
 */
describe('cell_load permission handling', () => {
  const src = readFileSync(
    path.resolve(__dirname, '../ws-handler.ts'),
    'utf-8',
  );

  it('should allow cell_load for owned sessions without strict subscription', () => {
    // The cell_load handler should check session ownership, not just subscription status
    // This prevents race conditions after page refresh

    // Look for a more permissive check pattern in cell_load handler
    // Either: skip checkSessionPermission, or use a separate ownership check
    const cellLoadSection = src.match(/case\s+'cell_load'[\s\S]*?break;\s*}/);
    expect(cellLoadSection).not.toBeNull();

    // Check if there's ownership validation (sessionOwningUser check)
    // or if it allows owned sessions without subscription
    const hasOwnershipCheck =
      cellLoadSection?.[0]?.includes('sessionOwningUser') ||
      cellLoadSection?.[0]?.includes('checkSessionOwnership') ||
      // Or: the checkSessionPermission is skipped/modified for cell_load
      !cellLoadSection?.[0]?.includes('checkSessionPermission(session_id)');

    // This test will FAIL until the fix is applied
    expect(hasOwnershipCheck).toBe(true);
  });
});
