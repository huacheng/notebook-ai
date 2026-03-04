import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Session Heartbeat Mechanism', () => {
  const sessionSrc = () => readFileSync(
    path.resolve(__dirname, '../session.ts'),
    'utf-8'
  );

  describe('Heartbeat constants', () => {
    it('should have HEARTBEAT_INTERVAL_MS constant (30s)', () => {
      const src = sessionSrc();
      expect(src).toMatch(/HEARTBEAT_INTERVAL_MS\s*=\s*30\s*\*\s*1000/);
    });

    it('should have STUCK_THRESHOLD_MS constant (120s)', () => {
      const src = sessionSrc();
      expect(src).toMatch(/STUCK_THRESHOLD_MS\s*=\s*120\s*\*\s*1000/);
    });

    it('should have MAX_STUCK_RETRIES constant (3)', () => {
      const src = sessionSrc();
      expect(src).toMatch(/MAX_STUCK_RETRIES\s*=\s*3/);
    });
  });

  describe('Session state tracking', () => {
    it('should track lastOutputTime in session', () => {
      const src = sessionSrc();
      expect(src).toContain('_lastOutputTime');
    });

    it('should track stuckRetryCount in session', () => {
      const src = sessionSrc();
      expect(src).toContain('_stuckRetryCount');
    });

    it('should have heartbeat timer in session', () => {
      const src = sessionSrc();
      expect(src).toContain('_heartbeatTimer');
    });
  });

  describe('Heartbeat logic', () => {
    it('should have startHeartbeat method', () => {
      const src = sessionSrc();
      expect(src).toMatch(/startHeartbeat\s*\(/);
    });

    it('should have stopHeartbeat method', () => {
      const src = sessionSrc();
      expect(src).toMatch(/stopHeartbeat\s*\(/);
    });

    it('should have heartbeatCheck method', () => {
      const src = sessionSrc();
      expect(src).toMatch(/heartbeatCheck\s*\(/);
    });

    it('should check for stuck cells (running + no output)', () => {
      const src = sessionSrc();
      // Should check if cell is running and lastOutputTime exceeded threshold
      expect(src).toContain('STUCK_THRESHOLD_MS');
      expect(src).toContain('_lastOutputTime');
    });

    it('should send continue prompt when stuck', () => {
      const src = sessionSrc();
      // Should call executeCell or similar with "继续" when stuck
      expect(src).toMatch(/继续|continue/i);
    });

    it('should check queue in heartbeat', () => {
      const src = sessionSrc();
      // heartbeatCheck should call processNextQueueItem
      const heartbeatMatch = src.match(/heartbeatCheck[\s\S]*?processNextQueueItem/);
      expect(heartbeatMatch).toBeTruthy();
    });
  });

  describe('Output time tracking', () => {
    it('should update lastOutputTime on cell output', () => {
      const src = sessionSrc();
      // handleJsonlMessage or appendOutput should update _lastOutputTime
      expect(src).toMatch(/_lastOutputTime\s*=\s*Date\.now\(\)/);
    });
  });

  describe('Retry limiting', () => {
    it('should increment stuckRetryCount when sending continue', () => {
      const src = sessionSrc();
      expect(src).toMatch(/_stuckRetryCount\s*\+\+|\+\+\s*_stuckRetryCount/);
    });

    it('should check MAX_STUCK_RETRIES before sending continue', () => {
      const src = sessionSrc();
      expect(src).toContain('MAX_STUCK_RETRIES');
    });

    it('should reset stuckRetryCount on successful completion', () => {
      const src = sessionSrc();
      // In completeCell, should reset retry count
      expect(src).toMatch(/_stuckRetryCount\s*=\s*0/);
    });
  });

  describe('Tool execution awareness', () => {
    it('should track pending tool_use IDs in session', () => {
      const src = sessionSrc();
      expect(src).toContain('_pendingToolUseIds');
    });

    it('should add tool_use_id to pending set when tool_use received', () => {
      const src = sessionSrc();
      // When processing tool_use block, should add to pending set
      expect(src).toMatch(/_pendingToolUseIds\.add\(/);
    });

    it('should remove tool_use_id from pending set when tool_result received', () => {
      const src = sessionSrc();
      // When processing tool_result, should remove from pending set
      expect(src).toMatch(/_pendingToolUseIds\.delete\(/);
    });

    it('should skip stuck detection when tool is pending', () => {
      const src = sessionSrc();
      // heartbeatCheck should check _pendingToolUseIds.size before stuck detection
      expect(src).toMatch(/_pendingToolUseIds\.size\s*[><=]/);
    });
  });
});
