import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../components/FileViewerEditor.tsx'),
  'utf-8',
);

/**
 * P0-3: When format === 'html', content is passed directly to TipTap
 * without DOMPurify sanitization. Event handler attributes (onerror, etc.)
 * on allowed elements can survive StarterKit filtering.
 */
describe('FileViewerEditor HTML sanitization (P0-3)', () => {
  it('should sanitize HTML content with DOMPurify before passing to TipTap', () => {
    // The html branch must call DOMPurify.sanitize
    expect(src).toContain('DOMPurify');
    // Sanitize logic should exist in content preparation (initialContent or useEditor)
    expect(src).toContain('DOMPurify.sanitize');
    // Should handle HTML format specifically
    expect(src).toMatch(/format\s*===\s*['"]html['"]/);
  });
});
