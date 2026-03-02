import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Notebook mention integration', () => {
  // After consolidation, InputBar logic lives in shared/InputBar.tsx
  const src = readFileSync(
    path.resolve(__dirname, '../components/shared/InputBar.tsx'),
    'utf-8',
  );

  it('InputBar should use useMention hook', () => {
    expect(src).toMatch(/useMention/);
  });

  it('should render MentionPopup', () => {
    expect(src).toMatch(/<MentionPopup/);
  });

  it('should include all three plugins', () => {
    expect(src).toMatch(/SlashCommandPlugin/);
    expect(src).toMatch(/FileTreePlugin/);
    expect(src).toMatch(/CellRefPlugin/);
  });
});
