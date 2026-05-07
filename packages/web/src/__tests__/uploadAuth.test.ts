import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

// Auth is now cookie-based. InputBar uploads use credentials: 'same-origin' instead of Bearer.

/**
 * P1-10: File upload must use cookie-based auth (credentials: 'same-origin').
 * The old Bearer token approach has been replaced by session cookies.
 */
describe('Notebook file upload cookie auth (P1-10)', () => {
  it('fetch to /api/notebooks/.../files should use credentials: same-origin', () => {
    // Find the upload fetch call in pasteImages.ts
    const pasteImagesSrc = readFileSync(
      path.resolve(__dirname, '../utils/pasteImages.ts'),
      'utf-8',
    );
    expect(pasteImagesSrc).toMatch(/credentials.*same-origin/);
    // No Bearer tokens should remain
    expect(pasteImagesSrc).not.toMatch(/Authorization|Bearer/);
  });
});
