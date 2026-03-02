import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../../../shared/src/types.ts'),
  'utf-8',
);

/**
 * R8-S3: LoadCellsSchema.limit must have .max() cap to prevent
 * unbounded cell loading that could exhaust memory.
 */
describe('load_cells limit cap (R8-S3)', () => {
  it('should have a .max() cap on the limit field', () => {
    const start = src.indexOf('LoadCellsSchema');
    const end = src.indexOf('});', start);
    const block = src.slice(start, end);
    expect(block).toMatch(/limit:\s*z\.number\(\).*\.max\(/);
  });
});
