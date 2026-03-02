import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../../../shared/src/types.ts'),
  'utf-8',
);

/**
 * R8-S5: Annotation schemas path field must have a .max() length cap
 * to prevent oversized DB keys.
 */
describe('annotation path length cap (R8-S5)', () => {
  it('AnnotationLoadSchema.path should have .max()', () => {
    const start = src.indexOf('AnnotationLoadSchema');
    const end = src.indexOf('});', start);
    const block = src.slice(start, end);
    expect(block).toMatch(/path:\s*z\.string\(\)\.max\(/);
  });

  it('AnnotationSyncSchema.path should have .max()', () => {
    const start = src.indexOf('AnnotationSyncSchema');
    const end = src.indexOf('});', start);
    const block = src.slice(start, end);
    expect(block).toMatch(/path:\s*z\.string\(\)\.max\(/);
  });
});
