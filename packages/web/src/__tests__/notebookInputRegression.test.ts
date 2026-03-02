import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('NotebookInputBar regression tests', () => {
  const src = readFileSync(
    path.resolve(__dirname, '../components/Notebook.tsx'),
    'utf-8',
  );

  it('should still have paste handler', () => {
    expect(src).toMatch(/onPaste=\{handlePaste\}/);
  });

  it('should still have drop handler with MAX_DROP limit', () => {
    expect(src).toMatch(/onDrop=/);
    expect(src).toMatch(/MAX_DROP/);
  });

  it('should still have submit/run functionality', () => {
    expect(src).toMatch(/handleRun/);
    expect(src).toMatch(/submitPrompt/);
  });

  it('should still have file upload button', () => {
    expect(src).toMatch(/nb-attach-btn/);
    expect(src).toMatch(/fileInputRef/);
  });

  it('should still have disabled state handling', () => {
    expect(src).toMatch(/disabled=\{disabled\}/);
  });

  it('should still have placeholder text', () => {
    expect(src).toMatch(/placeholder=/);
  });
});
