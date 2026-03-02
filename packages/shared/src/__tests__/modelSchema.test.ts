import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../types.ts'),
  'utf-8',
);

describe('ChangeModel schema validation (P1-7)', () => {
  it('ChangeModelSchema.model should have regex constraint', () => {
    const start = src.indexOf('ChangeModelSchema = z.object');
    const end = src.indexOf('});', start);
    const block = src.slice(start, end);
    expect(block).toMatch(/model: z\.string\(\)\.regex\(/);
  });
});
