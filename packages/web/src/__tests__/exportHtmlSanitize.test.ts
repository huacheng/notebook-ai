import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../store/wsSlice.ts'),
  'utf-8',
);

/**
 * P0-1: export_complete creates a text/html Blob from server HTML.
 * Must sanitize with DOMPurify before creating the Blob to prevent XSS.
 */
describe('Export HTML sanitization (P0-1)', () => {
  it('should sanitize parsed.html with DOMPurify before Blob creation', () => {
    const caseStart = src.indexOf("case 'export_complete'");
    const caseEnd = src.indexOf('break;', caseStart);
    const block = src.slice(caseStart, caseEnd);
    expect(block).toContain('DOMPurify.sanitize');
  });
});
