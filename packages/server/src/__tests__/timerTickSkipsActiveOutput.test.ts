/**
 * Tests that timerTick skips sending CONTINUE when the agent is actively
 * producing output (recent _lastOutputTime), to avoid interrupting work.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('timerTick skips when agent is actively outputting', () => {
  it('should check _lastOutputTime recency before sending CONTINUE', () => {
    const src = sessionSrc();
    // The timerTick method should compare _lastOutputTime to Date.now()
    // to determine if agent is actively producing output
    const timerTickMethod = src.match(/private timerTick\([\s\S]*?(?=\n  \/\*\*|\n  \/\/ ──)/);
    expect(timerTickMethod).toBeTruthy();
    expect(timerTickMethod![0]).toContain('_lastOutputTime');
    // Should have a recency check — skip if output was recent
    expect(timerTickMethod![0]).toMatch(/Date\.now\(\)\s*-\s*session\._lastOutputTime/);
  });
});
