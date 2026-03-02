import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../components/FileViewerRender.tsx'),
  'utf-8',
);

/**
 * P1-11: The highlight restoration effect captures stale `highlights` in its
 * closure. The filter `!highlights[a.id]` should use the `prev` state from
 * the setHighlights callback instead.
 */
describe('highlight restoration stale closure (P1-11)', () => {
  it('should filter missing annotations inside setHighlights callback using prev', () => {
    // Find the restore effect
    const restoreStart = src.indexOf('Restore highlights from persisted');
    const restoreEnd = src.indexOf('deliberately omit highlights');
    const block = src.slice(restoreStart, restoreEnd);
    // The filter for missing annotations should use `prev` (from setHighlights callback)
    // not the outer `highlights` closure variable
    expect(block).toMatch(/prev\[.*\.id\]|prev\[a\.id\]/);
  });
});
