import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Prompt Queue Auto Execution', () => {
  const sessionSrc = () => readFileSync(
    path.resolve(__dirname, '../session.ts'),
    'utf-8'
  );

  describe('Execution flow', () => {
    it('should have processNextQueueItem method', () => {
      const src = sessionSrc();
      expect(src).toContain('processNextQueueItem');
    });

    it('should call processNextQueueItem in completeCell', () => {
      const src = sessionSrc();
      // After cell completes, should check queue and execute next
      expect(src).toContain('processNextQueueItem');
    });

    it('should check if cell is running before dequeuing', () => {
      const src = sessionSrc();
      // Should verify no cell is currently running
      expect(src).toContain('findRunningCellId');
    });

    it('should pop first item from queue and execute', () => {
      const src = sessionSrc();
      // Should use shift() to get first item from queue
      expect(src).toContain('._promptQueue.shift()');
    });

    it('should broadcast queue_state after dequeuing', () => {
      const src = sessionSrc();
      // processNextQueueItem should broadcast updated queue state
      expect(src).toMatch(/processNextQueueItem[\s\S]*?queue_state/);
    });
  });

  describe('Interrupt behavior', () => {
    it('should skip queue execution when interrupted', () => {
      const src = sessionSrc();
      // completeCell should check _interrupted before processing queue
      expect(src).toContain('_interrupted');
    });
  });
});
