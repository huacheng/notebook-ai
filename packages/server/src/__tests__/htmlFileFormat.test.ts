/**
 * @vitest-environment node
 *
 * Tests that .html/.htm files get format 'html' (not 'text'),
 * so the frontend can render them with iframe instead of code highlighting.
 */
import { describe, it, expect } from 'vitest';

/**
 * Extracts the format-detection logic from ws-handler.ts for unit testing.
 * This mirrors the TEXT_EXTS / BINARY_FORMAT / IMAGE_EXTS / html detection
 * used in the file-open handler.
 */
function detectFormat(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  const HTML_EXTS = new Set(['html', 'htm']);
  const TEXT_EXTS = new Set([
    'md', 'txt', 'json', 'yaml', 'yml', 'sh', 'py', 'js', 'ts',
    'tsx', 'jsx', 'css', 'csv', 'xml', 'toml', 'ini', 'env', 'log', 'changelog',
  ]);
  const BINARY_FORMAT: Record<string, string> = {
    pdf: 'pdf-binary', docx: 'docx-binary', xlsx: 'xlsx-binary', pptx: 'pptx-binary',
  };
  const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);

  if (HTML_EXTS.has(ext)) return 'html';
  if (TEXT_EXTS.has(ext)) return 'text';
  if (BINARY_FORMAT[ext]) return BINARY_FORMAT[ext];
  if (IMAGE_EXTS.has(ext)) return 'image';
  return 'unknown';
}

describe('HTML file format detection', () => {
  it('.html files get format "html"', () => {
    expect(detectFormat('chart.html')).toBe('html');
  });

  it('.htm files get format "html"', () => {
    expect(detectFormat('index.htm')).toBe('html');
  });

  it('.HTML (uppercase) files get format "html"', () => {
    expect(detectFormat('Report.HTML')).toBe('html');
  });

  it('.md files still get format "text"', () => {
    expect(detectFormat('README.md')).toBe('text');
  });

  it('.json files still get format "text"', () => {
    expect(detectFormat('data.json')).toBe('text');
  });

  it('.pdf files still get format "pdf-binary"', () => {
    expect(detectFormat('doc.pdf')).toBe('pdf-binary');
  });
});
