import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Prompt Queue Optimistic Updates', () => {
  const wsSliceSrc = () => readFileSync(
    path.resolve(__dirname, '../store/wsSlice.ts'),
    'utf-8'
  );

  describe('queuePrompt optimistic update', () => {
    it('should update local state before sending to server', () => {
      const src = wsSliceSrc();
      // queuePrompt should set state before ws.send
      const queuePromptMatch = src.match(/queuePrompt\([^)]*\)\s*\{[\s\S]*?ws\.send/);
      expect(queuePromptMatch).toBeTruthy();
      // Should have set() call before ws.send
      expect(queuePromptMatch![0]).toContain('set(');
    });
  });

  describe('removeQueueItem optimistic update', () => {
    it('should update local state before sending to server', () => {
      const src = wsSliceSrc();
      // removeQueueItem should filter local state before ws.send
      const removeMatch = src.match(/removeQueueItem\([^)]*\)\s*\{[\s\S]*?ws\.send/);
      expect(removeMatch).toBeTruthy();
      expect(removeMatch![0]).toContain('set(');
    });
  });
});

describe('Prompt Queue Shared Components', () => {
  it('should have shared truncatePrompt utility', () => {
    // Check if there's a shared utility for truncating prompts
    const utilExists = () => readFileSync(
      path.resolve(__dirname, '../utils/promptQueue.ts'),
      'utf-8'
    );
    expect(() => utilExists()).not.toThrow();
  });

  it('shared utility should export truncatePrompt', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../utils/promptQueue.ts'),
      'utf-8'
    );
    expect(src).toContain('truncatePrompt');
  });
});
