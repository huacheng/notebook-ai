/**
 * Tests that rerunNotebook stops Timer mode before rerunning,
 * preventing timer from injecting cells during rerun.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('rerunNotebook stops Timer mode', () => {
  it('should call stopTimerMode in rerunNotebook', () => {
    const src = sessionSrc();
    const rerunMethod = src.match(/async rerunNotebook\([\s\S]*?(?=\n  async [a-z]|\n  \/\*\*|\n  \/\/ ──)/);
    expect(rerunMethod).toBeTruthy();
    expect(rerunMethod![0]).toContain('stopTimerMode');
  });
});
