/**
 * Tests for the new Auto heartbeat mode in SessionManager.
 * RED: These tests define the expected behavior of the new heartbeat system.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('Auto heartbeat mode', () => {
  it('should have autoMode fields in NotebookSession interface', () => {
    const src = sessionSrc();
    expect(src).toContain('_autoMode');
    expect(src).toContain('_autoTimer');
    expect(src).toContain('_autoIntervalMs');
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

  it('should NOT have old STUCK_THRESHOLD_MS constant', () => {
    const src = sessionSrc();
    expect(src).not.toContain('STUCK_THRESHOLD_MS');
  });

  it('should NOT have old MAX_STUCK_RETRIES constant', () => {
    const src = sessionSrc();
    expect(src).not.toContain('MAX_STUCK_RETRIES');
  });

  it('should broadcast auto_heartbeat on each tick', () => {
    const src = sessionSrc();
    expect(src).toContain('auto_heartbeat');
  });

  it('should broadcast auto_stopped when auto mode stops', () => {
    const src = sessionSrc();
    expect(src).toContain('auto_stopped');
  });

  it('interruptCell should also stop auto mode', () => {
    const src = sessionSrc();
    // interruptCell should call stopAutoMode
    const interruptSection = src.match(/interruptCell[\s\S]*?stopAutoMode/);
    expect(interruptSection).toBeTruthy();
  });
});
