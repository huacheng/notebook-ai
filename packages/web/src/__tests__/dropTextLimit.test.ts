import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../components/Notebook.tsx'),
  'utf-8',
);

/**
 * P1-7: onDrop handler accepts arbitrary text from drag-and-drop without
 * length limit. Cross-origin drag can inject large/malicious content.
 */
describe('Notebook textarea onDrop validation (P1-7)', () => {
  it('should limit length of dropped text', () => {
    const dropIdx = src.indexOf('onDrop');
    const dropEnd = src.indexOf('onDragOver', dropIdx);
    const dropBlock = src.slice(dropIdx, dropEnd);
    // Should have some form of length limit (slice, substring, or MAX)
    expect(dropBlock).toMatch(/slice|substring|MAX_DROP|maxLength|\.length\s*>/);
  });
});
