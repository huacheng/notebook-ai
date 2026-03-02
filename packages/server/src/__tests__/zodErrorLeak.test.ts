import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../ws-handler.ts'),
  'utf-8',
);

/**
 * P1-1: Zod validation error.message is sent directly to the client,
 * leaking schema internals (field names, regex patterns, etc.).
 */
describe('Zod error message sanitization (P1-1)', () => {
  it('should not send raw result.error.message to client', () => {
    expect(src).not.toContain('result.error.message');
  });
});
