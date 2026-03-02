import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../../../shared/src/types.ts'),
  'utf-8',
);

/**
 * R8-S2: tool_result_response.content must have a .max() size cap
 * to prevent oversized payloads being piped to Claude process.
 */
describe('tool_result_response content cap (R8-S2)', () => {
  it('should have a .max() cap on the content field', () => {
    const start = src.indexOf("type: z.literal('tool_result_response')");
    const end = src.indexOf('})', start);
    const block = src.slice(start, end);
    expect(block).toMatch(/content:\s*z\.string\(\)\.max\(/);
  });
});
