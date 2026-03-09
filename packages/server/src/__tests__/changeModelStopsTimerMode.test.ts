/**
 * Tests that changeModel stops Timer mode before restarting the process,
 * preventing stale timer on the new agent process.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('changeModel stops Timer mode', () => {
  it('should call stopTimerMode in changeModel', () => {
    const src = sessionSrc();
    const changeModelMethod = src.match(/async changeModel\([\s\S]*?(?=\n  async [a-z]|\n  \/\*\*|\n  \/\/ ──)/);
    expect(changeModelMethod).toBeTruthy();
    expect(changeModelMethod![0]).toContain('stopTimerMode');
  });
});
