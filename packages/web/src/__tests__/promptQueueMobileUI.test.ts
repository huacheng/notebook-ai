import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Mobile Prompt Queue UI', () => {
  const notebookViewSrc = () => readFileSync(
    path.resolve(__dirname, '../components/mobile/MobileNotebookView.tsx'),
    'utf-8'
  );

  describe('MobilePromptQueue component integration', () => {
    it('should import MobilePromptQueue component', () => {
      const src = notebookViewSrc();
      expect(src).toContain('MobilePromptQueue');
    });

    it('should render MobilePromptQueue before MobileInputBar', () => {
      const src = notebookViewSrc();
      const queuePos = src.indexOf('<MobilePromptQueue');
      const inputBarPos = src.indexOf('<MobileInputBar');
      expect(queuePos).toBeGreaterThan(-1);
      expect(queuePos).toBeLessThan(inputBarPos);
    });
  });
});

describe('MobilePromptQueue component file', () => {
  const queueSrc = () => readFileSync(
    path.resolve(__dirname, '../components/mobile/MobilePromptQueue.tsx'),
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

  it('should have swipe-to-delete gesture', () => {
    const src = queueSrc();
    // Mobile should have swipe/touch gesture for delete
    expect(src).toMatch(/touch|swipe|gesture|onTouch/i);
  });

  it('should show queue count badge', () => {
    const src = queueSrc();
    expect(src).toContain('promptQueue.length');
  });
});
