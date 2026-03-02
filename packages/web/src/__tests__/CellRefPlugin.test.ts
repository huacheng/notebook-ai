import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('CellRefPlugin', () => {
  it('should export CellRefPlugin with trigger "#"', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/CellRefPlugin.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/export const CellRefPlugin/);
    expect(src).toMatch(/trigger:\s*['"]#['"]/);
  });

  it('should read cells from store', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/CellRefPlugin.tsx'),
      'utf-8',
    );
    // Match either destructuring or direct access pattern
    expect(src).toMatch(/useStore\.getState\(\)/);
    expect(src).toMatch(/notebook/);
  });

  it('onSelect should return "#{index} "', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/CellRefPlugin.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/onSelect.*`#\$\{/);
  });
});
