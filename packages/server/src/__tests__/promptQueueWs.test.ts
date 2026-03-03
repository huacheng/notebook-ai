import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Prompt Queue WebSocket Messages', () => {
  const wsHandlerSrc = () => readFileSync(
    path.resolve(__dirname, '../ws-handler.ts'),
    'utf-8'
  );

  const typesSrc = () => readFileSync(
    path.resolve(__dirname, '../../../shared/src/types.ts'),
    'utf-8'
  );

  describe('Message types in schema', () => {
    it('should have queue_prompt message type in WSClientMessageSchema', () => {
      const src = typesSrc();
      expect(src).toContain("type: z.literal('queue_prompt')");
    });

    it('should have queue_remove message type in WSClientMessageSchema', () => {
      const src = typesSrc();
      expect(src).toContain("type: z.literal('queue_remove')");
    });

    it('should have queue_reorder message type in WSClientMessageSchema', () => {
      const src = typesSrc();
      expect(src).toContain("type: z.literal('queue_reorder')");
    });
  });

  describe('Handler implementation', () => {
    it('should have queue_prompt case in ws-handler', () => {
      const src = wsHandlerSrc();
      expect(src).toContain("case 'queue_prompt':");
    });

    it('should have queue_remove case in ws-handler', () => {
      const src = wsHandlerSrc();
      expect(src).toContain("case 'queue_remove':");
    });

    it('should have queue_reorder case in ws-handler', () => {
      const src = wsHandlerSrc();
      expect(src).toContain("case 'queue_reorder':");
    });

    it('should call sessionManager.addToQueue for queue_prompt', () => {
      const src = wsHandlerSrc();
      expect(src).toContain('addToQueue');
    });

    it('should call sessionManager.removeFromQueue for queue_remove', () => {
      const src = wsHandlerSrc();
      expect(src).toContain('removeFromQueue');
    });

    it('should call sessionManager.reorderQueue for queue_reorder', () => {
      const src = wsHandlerSrc();
      expect(src).toContain('reorderQueue');
    });

    it('should send queue_error on version mismatch', () => {
      const src = wsHandlerSrc();
      expect(src).toContain("type: 'queue_error'");
    });
  });
});
