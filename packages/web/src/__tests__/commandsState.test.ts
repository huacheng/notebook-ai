// packages/web/src/__tests__/commandsState.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('commands state in store', () => {
  it('wsSlice should have commands and commandsLoaded state', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../store/wsSlice.ts'),
      'utf-8',
    );
    expect(src).toMatch(/commands:\s*\[\]/);
    expect(src).toMatch(/commandsLoaded:\s*false/);
  });

  it('wsSlice should have setCommands action', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../store/wsSlice.ts'),
      'utf-8',
    );
    expect(src).toMatch(/setCommands:/);
  });
});
