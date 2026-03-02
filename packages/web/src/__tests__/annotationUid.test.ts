import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../types/fileAnnotations.ts'),
  'utf-8',
);

/**
 * R8-F2: Annotation uid() should use crypto.randomUUID() instead of
 * a predictable counter-based scheme.
 */
describe('annotation uid() randomness (R8-F2)', () => {
  it('should use crypto.randomUUID() instead of counter', () => {
    const fnStart = src.indexOf('function uid()');
    const fnEnd = src.indexOf('\n}', fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/crypto\.randomUUID/);
    expect(fnBody).not.toMatch(/_idCounter/);
  });
});
