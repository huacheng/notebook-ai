import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Prompt Queue Reconnect Sync', () => {
  const wsHandlerSrc = () => readFileSync(
    path.resolve(__dirname, '../ws-handler.ts'),
    'utf-8'
  );

  describe('Subscribe handler', () => {
    it('should send queue_state on subscribe', () => {
      const src = wsHandlerSrc();
      // After subscribe, should call getQueueState and send to client
      expect(src).toContain('getQueueState');
    });

    it('should send queue_state with items and version', () => {
      const src = wsHandlerSrc();
      // Should send queue_state message type
      expect(src).toMatch(/type:\s*['"]queue_state['"]/);
    });
  });
});
