import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../components/FileViewerEditor.tsx'),
  'utf-8',
);

/**
 * P0-2: Text file content is interpolated raw into HTML template for TipTap.
 * Must HTML-escape <, >, & before interpolation to prevent XSS.
 */
describe('FileViewerEditor text escape (P0-2)', () => {
  it('should HTML-escape text content before inserting into pre/code', () => {
    const editorBlock = src.slice(
      src.indexOf('useEditor('),
      src.indexOf('});', src.indexOf('useEditor(')) + 3,
    );
    // Should contain escaping logic
    const hasEscape = /escapeHtml|\.replace\(.*[<&]|DOMPurify|sanitize/.test(editorBlock);
    expect(hasEscape).toBe(true);
  });
});
