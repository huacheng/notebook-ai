import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('MentionPlugin types', () => {
  it('types.ts should export MentionPlugin interface', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/types.ts'),
      'utf-8',
    );
    expect(src).toMatch(/export interface MentionPlugin/);
    expect(src).toMatch(/trigger:\s*string/);
    expect(src).toMatch(/fetchItems:/);
    expect(src).toMatch(/renderItem:/);
    expect(src).toMatch(/onSelect:/);
  });
});
