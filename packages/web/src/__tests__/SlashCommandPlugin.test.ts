import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('SlashCommandPlugin', () => {
  it('should export SlashCommandPlugin with trigger "/"', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/SlashCommandPlugin.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/export const SlashCommandPlugin/);
    expect(src).toMatch(/trigger:\s*['"]\/['"]/);
  });

  it('should have fetchItems that calls /api/commands', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/SlashCommandPlugin.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/\/api\/commands/);
  });

  it('onSelect should return "/{name} "', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../mention/SlashCommandPlugin.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/onSelect.*`\/\$\{/);
  });
});
