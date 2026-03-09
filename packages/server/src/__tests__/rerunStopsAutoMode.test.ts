/**
 * Tests that rerunNotebook stops Auto mode before rerunning,
 * preventing auto timer from injecting cells during rerun.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('rerunNotebook stops Auto mode', () => {
  it('should call stopAutoMode in rerunNotebook', () => {
    const src = sessionSrc();
    const rerunMethod = src.match(/async rerunNotebook\([\s\S]*?(?=\n  async [a-z]|\n  \/\*\*|\n  \/\/ ──)/);
    expect(rerunMethod).toBeTruthy();
    expect(rerunMethod![0]).toContain('stopAutoMode');
  });
});
