import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../ws-handler.ts'),
  'utf-8',
);

/**
 * P1-11: file-open handler should reject files exceeding a size limit
 * to prevent memory exhaustion from reading huge files into WS buffers.
 */
describe('file-open size limit (P1-11)', () => {
  it('should check stat.size against a MAX limit before reading', () => {
    const caseStart = src.indexOf("case 'file-open'");
    const nextCase = src.indexOf("\n        case ", caseStart + 1);
    const block = src.slice(caseStart, nextCase > 0 ? nextCase : caseStart + 2000);
    // Must contain a size check (e.g., stat.size > MAX_FILE_SIZE)
    expect(block).toMatch(/stat\.size\s*>/);
  });
});
