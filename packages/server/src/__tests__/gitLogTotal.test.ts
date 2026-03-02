import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../ws-handler.ts'),
  'utf-8',
);

/**
 * P1-3: computeGitLog returns `total: commits.length` which is the page count,
 * not the grand total. The field name `total` is misleading for pagination.
 */
describe('git_log total field naming (P1-3)', () => {
  it('should not use misleading "total" for page-level commit count', () => {
    const returnLine = src.slice(
      src.indexOf('return { commits,'),
      src.indexOf('\n', src.indexOf('return { commits,')),
    );
    // Should use "count" instead of "total" for the page-level count
    expect(returnLine).not.toMatch(/total:\s*commits\.length/);
    expect(returnLine).toContain('count');
  });
});
