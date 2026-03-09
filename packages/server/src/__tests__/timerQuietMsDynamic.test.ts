/**
 * Tests that the "output quiet" threshold is derived from the session's
 * actual _timerIntervalMs, not from the global DEFAULT_TIMER_INTERVAL_MS.
 * A user who sets interval=30s should have quiet=15s, not quiet=150s.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('timerTick quiet threshold is dynamic per session', () => {
  it('should compute quiet threshold from session._timerIntervalMs, not a global constant', () => {
    const src = sessionSrc();
    const timerTickMethod = src.match(/private timerTick\([\s\S]*?(?=\n  \/\*\*|\n  \/\/ ──)/);
    expect(timerTickMethod).toBeTruthy();
    const body = timerTickMethod![0];
    // Should reference session._timerIntervalMs in the quiet threshold calculation
    expect(body).toContain('_timerIntervalMs');
    // Should NOT use the global TIMER_OUTPUT_QUIET_MS constant
    expect(body).not.toContain('TIMER_OUTPUT_QUIET_MS');
  });
});
