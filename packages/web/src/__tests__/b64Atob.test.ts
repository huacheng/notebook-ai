import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../utils/b64.ts'),
  'utf-8',
);

/**
 * R8-F4: b64ToUint8Array should use atob() instead of fetch(data:...)
 * to reduce memory overhead for large binary files.
 */
describe('b64ToUint8Array uses atob (R8-F4)', () => {
  it('should use atob instead of fetch data URI', () => {
    expect(src).toMatch(/atob/);
    expect(src).not.toMatch(/fetch\(`data:/);
  });
});
