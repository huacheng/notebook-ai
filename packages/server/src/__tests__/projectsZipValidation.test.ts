import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../routes/projects.ts'),
  'utf-8',
);

describe('Projects zip download symlink safety (P1-2)', () => {
  const handlerStart = src.indexOf("files/zip");
  const handlerEnd = src.indexOf('router.', handlerStart + 1);
  const block = src.slice(handlerStart, handlerEnd > 0 ? handlerEnd : handlerStart + 1000);

  it('should use realpath for symlink-safe path validation', () => {
    expect(block).toMatch(/realpath/);
  });
});
