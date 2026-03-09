/**
 * Tests that startTimerMode resets _timerExecuting to false,
 * preventing stale flag from blocking the first tick.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('startTimerMode resets _timerExecuting', () => {
  it('should reset _timerExecuting to false in startTimerMode', () => {
    const src = sessionSrc();
    const startMethod = src.match(/startTimerMode[\s\S]*?(?=\n  \/\*\*|\n  \/\/ ──)/);
    expect(startMethod).toBeTruthy();
    expect(startMethod![0]).toContain('_timerExecuting');
  });
});
