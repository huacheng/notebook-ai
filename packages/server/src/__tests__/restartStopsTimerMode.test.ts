/**
 * Tests that restartSession stops Timer mode before restarting the agent process,
 * preventing stale timers from interacting with a new process.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('restartSession stops Timer mode', () => {
  it('should call stopTimerMode in restartSession', () => {
    const src = sessionSrc();
    // Find the restartSession method body (between its signature and _spawnAgent)
    const start = src.indexOf('restartSession(sessionId: string');
    const end = src.indexOf('_spawnAgent', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain('stopTimerMode');
  });
});
