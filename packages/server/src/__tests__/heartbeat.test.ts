import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('Session Heartbeat & Auto Mode', () => {
  const sessionSrc = () => readFileSync(
    path.resolve(__dirname, '../session.ts'),
    'utf-8'
  );

  describe('Health-check heartbeat', () => {
    it('should have HEARTBEAT_INTERVAL_MS constant (30s)', () => {
      const src = sessionSrc();
      expect(src).toMatch(/HEARTBEAT_INTERVAL_MS\s*=\s*30\s*\*\s*1000/);
    });

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

    it('should check agentProcess.isAlive() in heartbeat', () => {
      const src = sessionSrc();
      expect(src).toMatch(/heartbeatCheck[\s\S]*?agentProcess\.isAlive\(\)/);
    });

    it('should broadcast process_dead event when process dies', () => {
      const src = sessionSrc();
      expect(src).toContain('process_dead');
    });

    it('should complete running cell as error when process is dead', () => {
      const src = sessionSrc();
      const match = src.match(/heartbeatCheck[\s\S]*?!session\.agentProcess\.isAlive\(\)[\s\S]*?completeCell/);
      expect(match).toBeTruthy();
    });
  });

  describe('Auto mode', () => {
    it('should have DEFAULT_AUTO_INTERVAL_MS constant', () => {
      const src = sessionSrc();
      expect(src).toMatch(/DEFAULT_AUTO_INTERVAL_MS\s*=/);
    });

    it('should have _autoMode field in session', () => {
      const src = sessionSrc();
      expect(src).toContain('_autoMode');
    });

    it('should have _autoTimer field in session', () => {
      const src = sessionSrc();
      expect(src).toContain('_autoTimer');
    });

    it('should have _autoIntervalMs field in session', () => {
      const src = sessionSrc();
      expect(src).toContain('_autoIntervalMs');
    });

    it('should have _autoIterationCount field in session', () => {
      const src = sessionSrc();
      expect(src).toContain('_autoIterationCount');
    });

    it('should have startAutoMode method', () => {
      const src = sessionSrc();
      expect(src).toMatch(/startAutoMode\s*\(/);
    });

    it('should have stopAutoMode method', () => {
      const src = sessionSrc();
      expect(src).toMatch(/stopAutoMode\s*\(/);
    });

    it('should broadcast auto_heartbeat on each tick', () => {
      const src = sessionSrc();
      expect(src).toContain('auto_heartbeat');
    });

    it('should broadcast auto_stopped when stopping', () => {
      const src = sessionSrc();
      expect(src).toContain('auto_stopped');
    });

    it('should use CONTINUE_PROMPT in autoTick', () => {
      const src = sessionSrc();
      expect(src).toMatch(/autoTick[\s\S]*?CONTINUE_PROMPT/);
    });

    it('interruptCell should stop auto mode', () => {
      const src = sessionSrc();
      const match = src.match(/interruptCell[\s\S]*?stopAutoMode/);
      expect(match).toBeTruthy();
    });
  });

  describe('Tool execution awareness', () => {
    it('should track pending tool_use IDs', () => {
      const src = sessionSrc();
      expect(src).toContain('_pendingToolUseIds');
    });

    it('should have TOOL_LONG_RUNNING_MS constant', () => {
      const src = sessionSrc();
      expect(src).toMatch(/TOOL_LONG_RUNNING_MS\s*=/);
    });

    it('should broadcast tool_long_running event', () => {
      const src = sessionSrc();
      expect(src).toContain('tool_long_running');
    });

    it('should track _toolLongRunningNotified to prevent spam', () => {
      const src = sessionSrc();
      expect(src).toContain('_toolLongRunningNotified');
    });

    it('should clear pendingToolUseIds in completeCell', () => {
      const src = sessionSrc();
      const match = src.match(/completeCell[\s\S]*?_pendingToolUseIds\.clear\(\)/);
      expect(match).toBeTruthy();
    });
  });

  describe('Timer cleanup', () => {
    it('should clear heartbeat timer on session close', () => {
      const src = sessionSrc();
      const match = src.match(/stopHeartbeat[\s\S]*?sessions\.delete|_heartbeatTimer[\s\S]*?sessions\.delete/);
      expect(match).toBeTruthy();
    });

    it('should stop auto mode on session close', () => {
      const src = sessionSrc();
      const match = src.match(/closeSession[\s\S]*?stopAutoMode/);
      expect(match).toBeTruthy();
    });
  });
});
