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

  describe('Timer mode', () => {
    it('should have DEFAULT_TIMER_INTERVAL_MS constant', () => {
      const src = sessionSrc();
      expect(src).toMatch(/DEFAULT_TIMER_INTERVAL_MS\s*=/);
    });

    it('should have _timerMode field in session', () => {
      const src = sessionSrc();
      expect(src).toContain('_timerMode');
    });

    it('should have _timerHandle field in session', () => {
      const src = sessionSrc();
      expect(src).toContain('_timerHandle');
    });

    it('should have _timerIntervalMs field in session', () => {
      const src = sessionSrc();
      expect(src).toContain('_timerIntervalMs');
    });

    it('should have _timerIterationCount field in session', () => {
      const src = sessionSrc();
      expect(src).toContain('_timerIterationCount');
    });

    it('should have startTimerMode method', () => {
      const src = sessionSrc();
      expect(src).toMatch(/startTimerMode\s*\(/);
    });

    it('should have stopTimerMode method', () => {
      const src = sessionSrc();
      expect(src).toMatch(/stopTimerMode\s*\(/);
    });

    it('should broadcast timer_heartbeat on each tick', () => {
      const src = sessionSrc();
      expect(src).toContain('timer_heartbeat');
    });

    it('should broadcast timer_stopped when stopping', () => {
      const src = sessionSrc();
      expect(src).toContain('timer_stopped');
    });

    it('should use CONTINUE_PROMPT in timerTick', () => {
      const src = sessionSrc();
      expect(src).toMatch(/timerTick[\s\S]*?CONTINUE_PROMPT/);
    });

    it('interruptCell should stop timer mode', () => {
      const src = sessionSrc();
      const match = src.match(/interruptCell[\s\S]*?stopTimerMode/);
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

    it('should stop timer mode on session close', () => {
      const src = sessionSrc();
      const match = src.match(/closeSession[\s\S]*?stopTimerMode/);
      expect(match).toBeTruthy();
    });
  });
});
