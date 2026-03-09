/**
 * Tests that startAutoMode resets _autoExecuting to false,
 * preventing stale flag from blocking the first tick.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('startAutoMode resets _autoExecuting', () => {
  it('should reset _autoExecuting to false in startAutoMode', () => {
    const src = sessionSrc();
    const startMethod = src.match(/startAutoMode[\s\S]*?(?=\n  \/\*\*|\n  \/\/ ──)/);
    expect(startMethod).toBeTruthy();
    expect(startMethod![0]).toContain('_autoExecuting');
  });
});
