/**
 * Tests that timer mode state is reset when WebSocket disconnects,
 * preventing stale UI (iteration count, active toggle) on reconnect.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const wsSliceSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../store/wsSlice.ts'), 'utf-8');

describe('Timer state reset on disconnect', () => {
  it('should reset timerMode on ws disconnect', () => {
    const src = wsSliceSrc();
    // Find the ws.onclose handler by looking for the full cleanup set() call
    // Must contain loadingCellIds AND timerMode to be the real onclose cleanup
    const oncloseBlock = src.match(/wsStatus:\s*'disconnected'[^;]*loadingCellIds[^;]*timerMode[^;]+;/);
    expect(oncloseBlock).toBeTruthy();
    expect(oncloseBlock![0]).toContain('timerMode: false');
  });

  it('should reset timerIterationCount on ws disconnect', () => {
    const src = wsSliceSrc();
    const oncloseBlock = src.match(/wsStatus:\s*'disconnected'[^;]*loadingCellIds[^;]*timerIterationCount[^;]+;/);
    expect(oncloseBlock).toBeTruthy();
    expect(oncloseBlock![0]).toContain('timerIterationCount: 0');
  });
});
