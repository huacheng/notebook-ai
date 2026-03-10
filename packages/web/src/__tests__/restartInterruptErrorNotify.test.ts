/**
 * Test: Generic WS error messages should surface as UI notifications
 * when restart or interrupt was in progress.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const wsSliceSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../store/wsSlice.ts'), 'utf-8');

describe('WS error surfaces restart/interrupt failure to UI', () => {
  it('case error should check restartPhase and surface as restartError', () => {
    const src = wsSliceSrc();
    // Find the case 'error' block
    const errorIdx = src.indexOf("case 'error':");
    const errorBlock = src.slice(errorIdx, errorIdx + 1200);
    // Should check restartPhase and set it to error when restarting
    expect(errorBlock).toMatch(/restartPhase/);
  });

  it('case error should handle interrupt failure (non-cell error)', () => {
    const src = wsSliceSrc();
    const errorIdx = src.indexOf("case 'error':");
    const errorBlock = src.slice(errorIdx, errorIdx + 1200);
    // Should show error for non-cell errors (interrupt, restart permission denied)
    // Either via restartPhase or a dedicated mechanism
    expect(errorBlock).toMatch(/restartPhase.*error|interruptError/);
  });
});
