import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Queue Store Slice', () => {
  const typesSrc = () => readFileSync(
    path.resolve(__dirname, '../store/types.ts'),
    'utf-8'
  );

  const wsSliceSrc = () => readFileSync(
    path.resolve(__dirname, '../store/wsSlice.ts'),
    'utf-8'
  );

  describe('State definitions in types.ts', () => {
    it('should have promptQueue state in NotebookStore', () => {
      const src = typesSrc();
      expect(src).toContain('promptQueue:');
    });

    it('should have queueVersion state in NotebookStore', () => {
      const src = typesSrc();
      expect(src).toContain('queueVersion:');
    });

    it('should have queuePrompt action in NotebookStore', () => {
      const src = typesSrc();
      expect(src).toContain('queuePrompt(');
    });

    it('should have removeQueueItem action in NotebookStore', () => {
      const src = typesSrc();
      expect(src).toContain('removeQueueItem(');
    });

    it('should have reorderQueue action in NotebookStore', () => {
      const src = typesSrc();
      expect(src).toContain('reorderQueue(');
    });
  });

  describe('Implementation in wsSlice.ts', () => {
    it('should have promptQueue initial state', () => {
      const src = wsSliceSrc();
      expect(src).toContain('promptQueue:');
    });

    it('should have queueVersion initial state', () => {
      const src = wsSliceSrc();
      expect(src).toContain('queueVersion:');
    });

    it('should handle queue_state message', () => {
      const src = wsSliceSrc();
      expect(src).toContain("case 'queue_state':");
    });

    it('should implement queuePrompt function', () => {
      const src = wsSliceSrc();
      expect(src).toContain('queuePrompt(');
    });

    it('should implement removeQueueItem function', () => {
      const src = wsSliceSrc();
      expect(src).toContain('removeQueueItem(');
    });

    it('should implement reorderQueue function', () => {
      const src = wsSliceSrc();
      expect(src).toContain('reorderQueue(');
    });
  });
});
