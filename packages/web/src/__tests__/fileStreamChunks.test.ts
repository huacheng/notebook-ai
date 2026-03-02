import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../hooks/useFileStream.ts'),
  'utf-8',
);

/**
 * P1-9: File chunks are accumulated via string concatenation (+=), which is
 * O(n²) for large files. Should use array of chunks + join at the end.
 */
describe('useFileStream chunk accumulation (P1-9)', () => {
  it('should use array push instead of string concatenation for chunks', () => {
    const chunkCase = src.slice(
      src.indexOf("case 'file-chunk'"),
      src.indexOf("case 'file-open-end'"),
    );
    // Should NOT concatenate strings; should push to array
    expect(chunkCase).not.toContain('b64Ref.current +=');
    expect(chunkCase).not.toContain('contentRef.current +=');
    expect(chunkCase).toContain('.push(');
  });
});
