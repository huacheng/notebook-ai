/**
 * InputBar /auto command direct-submit and line numbers tests.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const inputBarSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../components/shared/InputBar.tsx'), 'utf-8');

describe('InputBar /auto direct submit', () => {
  it('should have task-ai:auto command call directSubmitCommand instead of insertCommand', () => {
    const src = inputBarSrc();
    // The /auto button should NOT use insertCommand — it should directly submit
    const autoButtonMatch = src.match(/cmd:\s*'task-ai:auto'[\s\S]*?onClick=\{[^}]*\}/);
    expect(autoButtonMatch).toBeTruthy();
    // Should NOT call insertCommand for auto
    expect(autoButtonMatch![0]).not.toContain('insertCommand');
  });

  it('should have a directSubmitCommand function that calls submitPrompt', () => {
    const src = inputBarSrc();
    // There should be a function that submits the command directly
    expect(src).toContain('directSubmitCommand');
    // It should call submitPrompt with the command text
    expect(src).toMatch(/directSubmitCommand[\s\S]*?submitPrompt/);
  });
});

describe('InputBar line numbers', () => {
  it('should render a line-number gutter element', () => {
    const src = inputBarSrc();
    expect(src).toContain('nb-line-numbers');
  });

  it('should compute line count from text content', () => {
    const src = inputBarSrc();
    // Line numbers should be derived from text split by newlines
    expect(src).toMatch(/split.*\\n/);
  });
});
