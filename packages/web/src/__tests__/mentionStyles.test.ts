import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Mention CSS styles', () => {
  it('should have .mention-popup styles', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../styles.css'),
      'utf-8',
    );
    expect(src).toMatch(/\.mention-popup\s*\{/);
  });

  it('should have .mention-item styles', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../styles.css'),
      'utf-8',
    );
    expect(src).toMatch(/\.mention-item\s*\{/);
    expect(src).toMatch(/\.mention-item\.selected/);
  });
});
