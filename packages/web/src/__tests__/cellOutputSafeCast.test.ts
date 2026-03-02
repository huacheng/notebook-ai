import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const src = readFileSync(
  path.resolve(__dirname, '../components/CellOutput.tsx'),
  'utf-8',
);

/**
 * P1-8: InteractiveOptionsWrapper casts item.input without runtime validation.
 * If the shape doesn't match, questions will be undefined → crash on .map().
 */
describe('CellOutput safe input cast (P1-8)', () => {
  it('should use optional chaining or fallback for item.input.questions', () => {
    const wrapperFn = src.slice(
      src.indexOf('InteractiveOptionsWrapper'),
      src.indexOf('\n}', src.indexOf('InteractiveOptionsWrapper')) + 2,
    );
    // Must have defensive access: ?.questions or ?? []
    expect(wrapperFn).toMatch(/\?\.\s*questions|\?\?.*\[\]/);
  });
});
