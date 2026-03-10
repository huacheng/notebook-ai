/**
 * Test: Timer mode should be persisted to localStorage and auto-restored on WS reconnect.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const wsSliceSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../store/wsSlice.ts'), 'utf-8');

describe('Timer mode persistence and auto-restore', () => {
  it('should persist timer state to localStorage when timer_started is received', () => {
    const src = wsSliceSrc();
    const timerStartedIdx = src.indexOf("case 'timer_started':");
    const block = src.slice(timerStartedIdx, timerStartedIdx + 600);
    // Should save timer state to localStorage
    expect(block).toMatch(/cacheSet|localStorage/);
  });

  it('should clear persisted timer state when timer_stopped is received', () => {
    const src = wsSliceSrc();
    const timerStoppedIdx = src.indexOf("case 'timer_stopped':");
    const block = src.slice(timerStoppedIdx, timerStoppedIdx + 600);
    // Should remove timer state from localStorage
    expect(block).toMatch(/cacheRemove|localStorage.*remove/);
  });

  it('should auto-restore timer mode on WS reconnect (onopen)', () => {
    const src = wsSliceSrc();
    const onopenIdx = src.indexOf('ws.onopen');
    const block = src.slice(onopenIdx, onopenIdx + 2000);
    // Should check for persisted timer state and send timer_start
    expect(block).toMatch(/timer_start|timer.*restore/);
  });
});
