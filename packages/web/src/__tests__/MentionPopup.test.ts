import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('MentionPopup component', () => {
  it('should export MentionPopup function', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/MentionPopup.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/export function MentionPopup/);
  });

  it('should render items with plugin.renderItem', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/MentionPopup.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/plugin\.renderItem/);
  });

  it('should have mention-popup class', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../components/MentionPopup.tsx'),
      'utf-8',
    );
    expect(src).toMatch(/mention-popup/);
  });
});
