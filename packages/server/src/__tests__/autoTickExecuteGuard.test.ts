/**
 * Tests that autoTick does not call executeCell when a cell is already
 * in the process of being created by a previous tick (prevents cascade).
 *
 * The autoTick else branch (no running cell) should check _executeLock
 * or use a flag to avoid queueing multiple executeCell calls.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('autoTick executeCell guard', () => {
  it('should have a guard to prevent concurrent executeCell calls from autoTick', () => {
    const src = sessionSrc();
    const autoTickBody = src.match(/private autoTick\([\s\S]*?(?=\n  \/\*\*|\n  private [a-z]|\n  \/\/ ──)/);
    expect(autoTickBody).toBeTruthy();
    // The else branch should guard with _autoExecuting before calling executeCell
    // Pattern: "else if (!session._autoExecuting)" prevents cascade
    const hasGuard = autoTickBody![0].match(/else\s+if\s*\(\s*!session\._autoExecuting[\s\S]*?executeCell/);
    expect(hasGuard).toBeTruthy();
  });
});
