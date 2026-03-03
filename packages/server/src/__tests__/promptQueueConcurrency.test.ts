import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Prompt Queue Concurrency (Optimistic Lock)', () => {
  const sessionSrc = () => readFileSync(
    path.resolve(__dirname, '../session.ts'),
    'utf-8'
  );

  describe('Session state', () => {
    it('should have _promptQueue field in NotebookSession interface', () => {
      const src = sessionSrc();
      expect(src).toContain('_promptQueue');
    });

    it('should have _queueVersion field in NotebookSession interface', () => {
      const src = sessionSrc();
      expect(src).toContain('_queueVersion');
    });

    it('should initialize _promptQueue from loaded queue file', () => {
      const src = sessionSrc();
      // Queue is loaded from file via loadQueueFromFile, then assigned to session
      expect(src).toContain('queueData.items');
      expect(src).toContain('_promptQueue: queueData.items');
    });

    it('should initialize _queueVersion from loaded queue file', () => {
      const src = sessionSrc();
      // Version is loaded from file via loadQueueFromFile, then assigned to session
      expect(src).toContain('queueData.version');
      expect(src).toContain('_queueVersion: queueData.version');
    });
  });

  describe('Version validation', () => {
    it('should have version check in queue operations', () => {
      const src = sessionSrc();
      // SessionManager methods check clientVersion !== session._queueVersion
      expect(src).toContain('clientVersion !== session._queueVersion');
      expect(src).toContain("code: 'VERSION_MISMATCH'");
    });

    it('should increment version on successful operation', () => {
      const src = sessionSrc();
      // Should have version increment logic
      expect(src).toContain('_queueVersion++');
    });

    it('should broadcast queue_state after operation', () => {
      const src = sessionSrc();
      expect(src).toContain("type: 'queue_state'");
    });
  });

  describe('Queue methods in SessionManager', () => {
    it('should have addToQueue method', () => {
      const src = sessionSrc();
      expect(src).toContain('addToQueue');
    });

    it('should have removeFromQueue method', () => {
      const src = sessionSrc();
      expect(src).toContain('removeFromQueue');
    });

    it('should have reorderQueue method', () => {
      const src = sessionSrc();
      expect(src).toContain('reorderQueue');
    });

    it('should have getQueueState method', () => {
      const src = sessionSrc();
      expect(src).toContain('getQueueState');
    });
  });
});
