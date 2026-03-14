import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../routes/projects.ts'),
  'utf-8',
);

/**
 * D2: notebook rename endpoint must use realpath() for symlink-safe
 * path validation, consistent with the delete by-path endpoint.
 * Without realpath(), a symlink can bypass the startsWith check
 * and allow writing metadata.title to a .notebook.json outside the project.
 */
describe('notebook rename symlink safety (D2)', () => {
  it('should use realpath for path validation in rename endpoint', () => {
    const routeStart = src.indexOf("router.patch('/:projectId/notebooks/rename'");
    expect(routeStart).toBeGreaterThan(-1);
    const routeEnd = src.indexOf('router.', routeStart + 1);
    const block = src.slice(routeStart, routeEnd > 0 ? routeEnd : routeStart + 2000);
    expect(block).toContain('realpath');
  });
});
