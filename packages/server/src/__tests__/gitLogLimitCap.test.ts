import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const typesSrc = readFileSync(
  path.resolve(__dirname, '../../../shared/src/types.ts'),
  'utf-8',
);

/**
 * R8-S1: git_log_request limit must have an upper bound cap (e.g., .max(100))
 * to prevent unbounded git log queries via WebSocket.
 */
describe('git_log_request limit cap (R8-S1)', () => {
  it('GitLogRequestSchema.limit should have a .max() cap', () => {
    // Find the GitLogRequestSchema definition
    const start = typesSrc.indexOf('GitLogRequestSchema');
    const end = typesSrc.indexOf('});', start);
    const block = typesSrc.slice(start, end);
    // Must have .max() on the limit field
    expect(block).toMatch(/limit:\s*z\.number\(\).*\.max\(/);
  });
});
