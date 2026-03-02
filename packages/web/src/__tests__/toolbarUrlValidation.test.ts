import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../components/Toolbar.tsx'),
  'utf-8',
);

/**
 * R8-F1: Before calling captureUrl, the toolbar should validate that
 * the URL uses http: or https: scheme (defense-in-depth).
 */
describe('Toolbar URL validation (R8-F1)', () => {
  it('should validate URL scheme before calling captureUrl', () => {
    // Find the onKeyDown handler block
    const captureCallIdx = src.indexOf('captureUrl(urlInput');
    const blockStart = src.lastIndexOf('onKeyDown', captureCallIdx);
    const block = src.slice(blockStart, captureCallIdx + 100);
    // Must have URL validation (protocol check or try/catch new URL)
    expect(block).toMatch(/https?:|protocol|new URL|\.protocol/);
  });
});
