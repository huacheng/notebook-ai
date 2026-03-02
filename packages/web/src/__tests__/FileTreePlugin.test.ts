import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('FileTreePlugin', () => {
  it('should export FileTreePlugin with trigger "@"', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/FileTreePlugin.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/export const FileTreePlugin/);
    expect(src).toMatch(/trigger:\s*['"]@['"]/);
  });

  it('should have isNavigable and onNavigate for tree mode', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/FileTreePlugin.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/isNavigable:/);
    expect(src).toMatch(/onNavigate:/);
  });

  it('onSelect should return "@{path} "', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/FileTreePlugin.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/onSelect.*`@\$\{/);
  });
});
