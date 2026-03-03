import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Desktop Prompt Queue UI', () => {
  const notebookSrc = () => readFileSync(
    path.resolve(__dirname, '../components/Notebook.tsx'),
    'utf-8'
  );

  describe('PromptQueue component integration', () => {
    it('should import PromptQueue component', () => {
      const src = notebookSrc();
      expect(src).toContain('PromptQueue');
    });

    it('should render PromptQueue before InputBar', () => {
      const src = notebookSrc();
      // PromptQueue should appear before NotebookInputBar in render
      const queuePos = src.indexOf('<PromptQueue');
      const inputBarPos = src.indexOf('<NotebookInputBar');
      expect(queuePos).toBeGreaterThan(-1);
      expect(queuePos).toBeLessThan(inputBarPos);
    });
  });
});

describe('PromptQueue component file', () => {
  const queueSrc = () => readFileSync(
    path.resolve(__dirname, '../components/PromptQueue.tsx'),
    'utf-8'
  );

  it('should exist', () => {
    expect(() => queueSrc()).not.toThrow();
  });

  it('should use promptQueue from store', () => {
    const src = queueSrc();
    expect(src).toContain('promptQueue');
  });

  it('should have delete functionality', () => {
    const src = queueSrc();
    expect(src).toContain('removeQueueItem');
  });

  it('should have reorder functionality', () => {
    const src = queueSrc();
    expect(src).toContain('reorderQueue');
  });

  it('should truncate long prompts', () => {
    const src = queueSrc();
    // Should have logic to truncate at ~80 chars
    expect(src).toMatch(/slice|substring|truncate/i);
  });
});
