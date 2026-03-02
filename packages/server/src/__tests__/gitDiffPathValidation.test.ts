import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../ws-handler.ts'),
  'utf-8',
);

/**
 * P1-2: git_diff_request file parameter uses weak manual checks (.. and /)
 * instead of validateWorkspacePath().
 */
describe('git_diff_request file path validation (P1-2)', () => {
  it('should use validateWorkspacePath for file parameter', () => {
    const caseStart = src.indexOf("case 'git_diff_request'");
    const nextCase = src.indexOf('\n        case ', caseStart + 1);
    const block = src.slice(caseStart, nextCase > 0 ? nextCase : caseStart + 2000);
    expect(block).toContain('validateWorkspacePath');
  });
});
