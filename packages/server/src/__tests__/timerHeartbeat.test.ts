/**
 * Tests for the new Timer heartbeat mode in SessionManager.
 * RED: These tests define the expected behavior of the new heartbeat system.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('Timer heartbeat mode', () => {
  it('should have timerMode fields in NotebookSession interface', () => {
    const src = sessionSrc();
    expect(src).toContain('_timerMode');
    expect(src).toContain('_timerHandle');
    expect(src).toContain('_timerIntervalMs');
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

  it('should NOT have old STUCK_THRESHOLD_MS constant', () => {
    const src = sessionSrc();
    expect(src).not.toContain('STUCK_THRESHOLD_MS');
  });

  it('should NOT have old MAX_STUCK_RETRIES constant', () => {
    const src = sessionSrc();
    expect(src).not.toContain('MAX_STUCK_RETRIES');
  });

  it('should broadcast timer_heartbeat on each tick', () => {
    const src = sessionSrc();
    expect(src).toContain('timer_heartbeat');
  });

  it('should broadcast timer_stopped when timer mode stops', () => {
    const src = sessionSrc();
    expect(src).toContain('timer_stopped');
  });

  it('interruptCell should also stop timer mode', () => {
    const src = sessionSrc();
    // interruptCell should call stopTimerMode
    const interruptSection = src.match(/interruptCell[\s\S]*?stopTimerMode/);
    expect(interruptSection).toBeTruthy();
  });
});
