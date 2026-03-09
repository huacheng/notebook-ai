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
    // Find the onclose handler that sets wsStatus: 'disconnected' with ws: null (the real close handler)
    const oncloseBlock = src.match(/wsStatus:\s*'disconnected',\s*ws:\s*null[\s\S]*?\}/);
    expect(oncloseBlock).toBeTruthy();
    expect(oncloseBlock![0]).toContain('timerMode');
  });

  it('should reset timerIterationCount on ws disconnect', () => {
    const src = wsSliceSrc();
    const oncloseBlock = src.match(/wsStatus:\s*'disconnected',\s*ws:\s*null[\s\S]*?\}/);
    expect(oncloseBlock).toBeTruthy();
    expect(oncloseBlock![0]).toContain('timerIterationCount');
  });
});
