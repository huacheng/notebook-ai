// packages/web/src/__tests__/useMention.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('useMention hook', () => {
  it('should export useMention function', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../hooks/useMention.ts'),
      'utf-8',
    );
    expect(src).toMatch(/export function useMention/);
  });

  it('should detect trigger characters', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../hooks/useMention.ts'),
      'utf-8',
    );
    expect(src).toMatch(/plugin\.trigger/);
    expect(src).toMatch(/triggerPos/);
  });

  it('should handle keyboard navigation', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../hooks/useMention.ts'),
      'utf-8',
    );
    expect(src).toMatch(/ArrowUp/);
    expect(src).toMatch(/ArrowDown/);
    expect(src).toMatch(/Tab|Enter/);
    expect(src).toMatch(/Escape/);
  });

  it('should return state and handlers', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../hooks/useMention.ts'),
      'utf-8',
    );
    expect(src).toMatch(/return\s*\{/);
    expect(src).toMatch(/state/);
    expect(src).toMatch(/handleChange/);
    expect(src).toMatch(/handleKeyDown/);
  });
});
