import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * D1-3: Cell source sync must use per-cell debounce timers,
 * not a single shared timer that loses edits when switching cells.
 */
describe('D1-3: per-cell debounce timer for updateCellSource', () => {
  const src = readFileSync(
    path.resolve(__dirname, '../store/notebookSlice.ts'),
    'utf-8',
  );

  it('should use a Map for sync timers instead of a single variable', () => {
    // Should have Map<string, ...> for timers, not a single let variable
    const hasTimerMap = /Map<string,\s*ReturnType/.test(src) ||
      /_sourceSyncTimers.*=.*new\s+Map/.test(src);
    expect(hasTimerMap).toBe(true);
  });

  it('should not use a single _sourceSyncTimer variable', () => {
    // The old pattern: let _sourceSyncTimer: ReturnType<typeof setTimeout> | null = null;
    const hasSingleTimer = /let\s+_sourceSyncTimer\s*:\s*ReturnType/.test(src);
    expect(hasSingleTimer).toBe(false);
  });
});
