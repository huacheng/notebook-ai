import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../ws-handler.ts'),
  'utf-8',
);

/**
 * P1-5: file-open reads the entire file (up to 50MB) into memory at once.
 * For binary files, base64 inflates this to ~67MB. Should use streaming reads.
 */
describe('file-open streaming reads (P1-5)', () => {
  it('should use createReadStream instead of readFile for file content', () => {
    const caseStart = src.indexOf("case 'file-open'");
    const nextCase = src.indexOf("\n        case '", caseStart + 1);
    const block = src.slice(caseStart, nextCase > 0 ? nextCase : caseStart + 3000);
    // Should use streaming API instead of reading entire file
    expect(block).toContain('createReadStream');
    expect(block).not.toContain('readFile(safePath)');
  });
});
