/**
 * Tests that timerTick does not call executeCell when a cell is already
 * in the process of being created by a previous tick (prevents cascade).
 *
 * The timerTick else branch (no running cell) should check _executeLock
 * or use a flag to avoid queueing multiple executeCell calls.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('timerTick executeCell guard', () => {
  it('should have a guard to prevent concurrent executeCell calls from timerTick', () => {
    const src = sessionSrc();
    const timerTickBody = src.match(/private timerTick\([\s\S]*?(?=\n  \/\*\*|\n  private [a-z]|\n  \/\/ ──)/);
    expect(timerTickBody).toBeTruthy();
    // The else branch should guard with _timerExecuting before calling executeCell
    // Pattern: "else if (!session._timerExecuting)" prevents cascade
    const hasGuard = timerTickBody![0].match(/else\s+if\s*\(\s*!session\._timerExecuting[\s\S]*?executeCell/);
    expect(hasGuard).toBeTruthy();
  });
});
