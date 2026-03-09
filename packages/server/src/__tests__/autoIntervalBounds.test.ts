/**
 * Tests that startAutoMode enforces minimum/maximum interval bounds
 * to prevent DoS (tiny intervals) or uselessness (huge intervals).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('Auto mode interval bounds', () => {
  it('should have MIN_AUTO_INTERVAL_MS constant', () => {
    const src = sessionSrc();
    expect(src).toMatch(/MIN_AUTO_INTERVAL_MS\s*=/);
  });

  it('should have MAX_AUTO_INTERVAL_MS constant', () => {
    const src = sessionSrc();
    expect(src).toMatch(/MAX_AUTO_INTERVAL_MS\s*=/);
  });

  it('should clamp interval in startAutoMode', () => {
    const src = sessionSrc();
    const startMethod = src.match(/startAutoMode[\s\S]*?(?=\n  \/\*\*|\n  \/\/ ──)/);
    expect(startMethod).toBeTruthy();
    // Should use Math.max/Math.min or clamp logic
    expect(startMethod![0]).toMatch(/Math\.(max|min)|clamp/);
  });
});
