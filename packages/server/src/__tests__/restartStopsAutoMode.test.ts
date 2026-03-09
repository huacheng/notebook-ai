/**
 * Tests that restartSession stops Auto mode before restarting the agent process,
 * preventing stale timers from interacting with a new process.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('restartSession stops Auto mode', () => {
  it('should call stopAutoMode in restartSession', () => {
    const src = sessionSrc();
    // Match the restartSession method definition specifically
    const restartMethod = src.match(/async restartSession\(sessionId[\s\S]*?(?=\n  \/\*\*|\n  async [a-z]|\n  \/\/ ──)/);
    expect(restartMethod).toBeTruthy();
    expect(restartMethod![0]).toContain('stopAutoMode');
  });
});
