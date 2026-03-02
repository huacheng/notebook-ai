import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../components/FileViewerRender.tsx'),
  'utf-8',
);

/**
 * P1-13: XlsxRenderer calls XLSX.read twice (initial load + sheet switch).
 * The workbook should be cached in a ref to avoid redundant parsing.
 */
describe('XLSX workbook caching (P1-13)', () => {
  it('XlsxRenderer should cache workbook in a ref', () => {
    const fnStart = src.indexOf('function XlsxRenderer');
    const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
    const block = src.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 1000);
    // Should use useRef to cache workbook and only call XLSX.read once
    expect(block).toContain('useRef');
    // Count XLSX.read occurrences — should be exactly 1
    const readCount = (block.match(/XLSX\.read\(/g) || []).length;
    expect(readCount).toBe(1);
  });
});
