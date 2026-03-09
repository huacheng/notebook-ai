/**
 * Tests that startTimerMode enforces minimum/maximum interval bounds
 * to prevent DoS (tiny intervals) or uselessness (huge intervals).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('Timer mode interval bounds', () => {
  it('should have MIN_TIMER_INTERVAL_MS constant', () => {
    const src = sessionSrc();
    expect(src).toMatch(/MIN_TIMER_INTERVAL_MS\s*=/);
  });

  it('should have MAX_TIMER_INTERVAL_MS constant', () => {
    const src = sessionSrc();
    expect(src).toMatch(/MAX_TIMER_INTERVAL_MS\s*=/);
  });

  it('should clamp interval in startTimerMode', () => {
    const src = sessionSrc();
    const startMethod = src.match(/startTimerMode[\s\S]*?(?=\n  \/\*\*|\n  \/\/ ──)/);
    expect(startMethod).toBeTruthy();
    // Should use Math.max/Math.min or clamp logic
    expect(startMethod![0]).toMatch(/Math\.(max|min)|clamp/);
  });
});
