import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../store/wsSlice.ts'),
  'utf-8',
);

/**
 * R8-F3: sessionNotice for session_already_open should be in English,
 * not hardcoded Chinese.
 */
describe('sessionNotice language (R8-F3)', () => {
  it('should not contain hardcoded Chinese for session_already_open', () => {
    const block = src.slice(
      src.indexOf('session_already_open'),
      src.indexOf('break', src.indexOf('session_already_open')),
    );
    // Should not contain Chinese characters
    expect(block).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
