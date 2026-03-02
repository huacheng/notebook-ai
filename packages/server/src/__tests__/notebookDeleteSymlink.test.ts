import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../routes/projects.ts'),
  'utf-8',
);

/**
 * P1-5: notebook delete by-path uses path.resolve() without realpath(),
 * so symlinks can bypass the startsWith check.
 */
describe('notebook delete by-path symlink safety (P1-5)', () => {
  it('should use realpath for path validation in by-path delete', () => {
    const routeStart = src.indexOf("router.delete('/:projectId/notebooks/by-path'");
    const routeEnd = src.indexOf('router.', routeStart + 1);
    const block = src.slice(routeStart, routeEnd > 0 ? routeEnd : routeStart + 2000);
    expect(block).toContain('realpath');
  });
});
