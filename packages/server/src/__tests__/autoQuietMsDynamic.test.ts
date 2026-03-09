/**
 * Tests that the "output quiet" threshold is derived from the session's
 * actual _autoIntervalMs, not from the global DEFAULT_AUTO_INTERVAL_MS.
 * A user who sets interval=30s should have quiet=15s, not quiet=150s.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('autoTick quiet threshold is dynamic per session', () => {
  it('should compute quiet threshold from session._autoIntervalMs, not a global constant', () => {
    const src = sessionSrc();
    const autoTickMethod = src.match(/private autoTick\([\s\S]*?(?=\n  \/\*\*|\n  \/\/ ──)/);
    expect(autoTickMethod).toBeTruthy();
    const body = autoTickMethod![0];
    // Should reference session._autoIntervalMs in the quiet threshold calculation
    expect(body).toContain('_autoIntervalMs');
    // Should NOT use the global AUTO_OUTPUT_QUIET_MS constant
    expect(body).not.toContain('AUTO_OUTPUT_QUIET_MS');
  });
});
