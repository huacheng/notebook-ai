/**
 * Test: Timer countdown should auto-reset when it reaches 0,
 * and timerIntervalSec should be stored in zustand store (not just a ref).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const notebookSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../components/Notebook.tsx'), 'utf-8');

const typesSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../store/types.ts'), 'utf-8');

describe('Timer countdown auto-reset at 0', () => {
  it('countdown tick should reset to interval when reaching 0 (not clamp at 0)', () => {
    const src = notebookSrc();
    // The setInterval callback should reset countdown when it hits 0
    // Look for logic that resets to timerIntervalSec or timerIntervalRef when prev reaches 0
    expect(src).toMatch(/prev\s*(-|<=)\s*1.*timerInterval/s);
  });

  it('store should have timerIntervalSec field', () => {
    const src = typesSrc();
    expect(src).toContain('timerIntervalSec');
  });

  it('timer_started handler should set timerIntervalSec in store', () => {
    const wsSliceSrc = fs.readFileSync(path.resolve(__dirname, '../store/wsSlice.ts'), 'utf-8');
    const idx = wsSliceSrc.indexOf("case 'timer_started':");
    const block = wsSliceSrc.slice(idx, idx + 600);
    expect(block).toMatch(/timerIntervalSec/);
  });
});
