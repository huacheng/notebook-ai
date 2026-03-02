import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Notebook mention integration', () => {
  it('NotebookInputBar should use useMention hook', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/Notebook.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/useMention/);
  });

  it('should render MentionPopup', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/Notebook.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/<MentionPopup/);
  });

  it('should include all three plugins', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/Notebook.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/SlashCommandPlugin/);
    expect(src).toMatch(/FileTreePlugin/);
    expect(src).toMatch(/CellRefPlugin/);
  });
});
