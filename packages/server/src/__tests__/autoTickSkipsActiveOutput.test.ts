/**
 * Tests that autoTick skips sending CONTINUE when the agent is actively
 * producing output (recent _lastOutputTime), to avoid interrupting work.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('autoTick skips when agent is actively outputting', () => {
  it('should check _lastOutputTime recency before sending CONTINUE', () => {
    const src = sessionSrc();
    // The autoTick method should compare _lastOutputTime to Date.now()
    // to determine if agent is actively producing output
    const autoTickMethod = src.match(/private autoTick\([\s\S]*?(?=\n  \/\*\*|\n  \/\/ ──)/);
    expect(autoTickMethod).toBeTruthy();
    expect(autoTickMethod![0]).toContain('_lastOutputTime');
    // Should have a recency check — skip if output was recent
    expect(autoTickMethod![0]).toMatch(/Date\.now\(\)\s*-\s*session\._lastOutputTime/);
  });
});
