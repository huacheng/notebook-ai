import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../routes/projects.ts'),
  'utf-8',
);

/**
 * P1-3: POST /import extracts tar.gz without path traversal protection.
 * Malicious archives can write files outside the extract directory via
 * absolute paths or "../" components.
 *
 * Fix: validate archive entries (tar tzf listing) BEFORE extraction.
 */
describe('POST /import tar-slip prevention (P1-3)', () => {
  it('should validate tar contents before extraction', () => {
    const importStart = src.indexOf("router.post('/import'");
    const importEnd = src.indexOf('router.', importStart + 1);
    const block = src.slice(importStart, importEnd > 0 ? importEnd : importStart + 3000);

    // The tar listing check (tar tzf) must appear BEFORE the tar extraction (tar xzf)
    const listingIdx = block.indexOf('tzf');
    const extractIdx = block.indexOf('xzf');
    expect(listingIdx).toBeGreaterThan(-1);
    expect(extractIdx).toBeGreaterThan(-1);
    expect(listingIdx).toBeLessThan(extractIdx);
  });
});
