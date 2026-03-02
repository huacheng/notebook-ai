import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../components/Notebook.tsx'),
  'utf-8',
);

/**
 * P1-10: File upload in Notebook.tsx must include Authorization header
 * to prevent unauthenticated uploads when auth is enabled.
 */
describe('Notebook file upload Authorization header (P1-10)', () => {
  it('fetch to /api/notebooks/.../files should include Authorization header', () => {
    // Find the upload fetch call
    const fetchIdx = src.indexOf("fetch(`/api/notebooks/");
    expect(fetchIdx).toBeGreaterThan(-1);
    // Check the surrounding context (200 chars) for auth header
    const block = src.slice(Math.max(0, fetchIdx - 100), fetchIdx + 300);
    expect(block).toMatch(/Authorization|authToken|Bearer/);
  });
});
