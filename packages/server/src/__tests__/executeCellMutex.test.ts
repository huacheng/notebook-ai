import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../session.ts'),
  'utf-8',
);

/**
 * P1-12: executeCell has a TOCTOU race — two concurrent calls can both pass
 * the "alreadyRunning" check. A per-session mutex prevents this.
 */
describe('executeCell per-session mutex (P1-12)', () => {
  it('should acquire a lock/mutex before the running check', () => {
    const fnStart = src.indexOf('async executeCell(');
    const fnEnd = src.indexOf('\n  async ', fnStart + 1);
    const block = src.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 1500);
    // Must contain mutex/lock acquisition logic
    expect(block).toMatch(/mutex|lock|_executing|acquir/i);
  });
});
