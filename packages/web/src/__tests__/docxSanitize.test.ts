import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../components/FileViewerRender.tsx'),
  'utf-8',
);

describe('DocxRenderer XSS prevention (P0-4)', () => {
  // Extract DocxRenderer function body
  const fnStart = src.indexOf('function DocxRenderer');
  expect(fnStart).toBeGreaterThan(-1);
  const fnEnd = src.indexOf('\nfunction ', fnStart + 1);
  const block = src.slice(fnStart, fnEnd > 0 ? fnEnd : fnStart + 600);

  it('should sanitize DOM after renderAsync completes', () => {
    // Must contain DOMPurify.sanitize call
    expect(block).toContain('DOMPurify.sanitize');
  });

  it('should call DOMPurify AFTER renderAsync', () => {
    const renderIdx = block.indexOf('renderAsync');
    const sanitizeIdx = block.indexOf('DOMPurify.sanitize');
    expect(renderIdx).toBeGreaterThan(-1);
    expect(sanitizeIdx).toBeGreaterThan(-1);
    expect(sanitizeIdx).toBeGreaterThan(renderIdx);
  });
});
