/**
 * @file interactiveOptionsAnswered.test.ts
 * Regression tests: AskUserQuestion should persist answered state
 *
 * Issue 1: After selecting an option, it should become disabled
 * Issue 2: When notebook is reopened, previously answered options should remain disabled
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('InteractiveOptions answered state persistence', () => {
  it('InteractiveOptionsWrapper should check item.result for initial answered state', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/CellOutput.tsx'),
      'utf-8'
    );

    // The wrapper should pass initialAnswered based on item.result
    expect(src).toMatch(/item\.result\s*!==?\s*undefined|item\.result\s*\?\?|hasResult|isAnswered/);
  });

  it('InteractiveOptions should accept initialAnswered prop', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/InteractiveOptions.tsx'),
      'utf-8'
    );

    // Should have initialAnswered in props interface
    expect(src).toContain('initialAnswered');
  });

  it('InteractiveOptions should initialize answered state from initialAnswered prop', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/InteractiveOptions.tsx'),
      'utf-8'
    );

    // useState should use initialAnswered as default
    expect(src).toMatch(/useState\s*\(\s*initialAnswered/);
  });

  it('buttons should be disabled when answered is true', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/InteractiveOptions.tsx'),
      'utf-8'
    );

    // Buttons should have disabled={answered}
    expect(src).toContain('disabled={answered}');
  });
});

describe('InteractiveOptions answer submission', () => {
  it('should have visual indicator for submitted state', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/InteractiveOptions.tsx'),
      'utf-8'
    );

    // Should show some indicator when answered
    expect(src).toMatch(/answered.*Submitted|interactive-options--answered/);
  });
});
