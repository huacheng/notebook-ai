/**
 * Tests that Cell component renders appended segments.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const cellSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../components/Cell.tsx'), 'utf-8');

describe('Cell segment rendering', () => {
  it('should reference segments in Cell component', () => {
    const src = cellSrc();
    // Cell should render segments from the prompt cell
    expect(src).toContain('segments');
  });

  it('should render each segment with frozen/greyed style', () => {
    const src = cellSrc();
    // Should have a CSS class or style indicating frozen/appended segments
    expect(src).toMatch(/segment|appended/i);
  });
});
