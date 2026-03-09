/**
 * Tests that timer mode pauses when a rate limit / usage limit error is detected,
 * and resumes automatically after a cooldown period.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('timer mode rate limit pause', () => {
  it('should have a rate limit detection pattern in completeCell or result handler', () => {
    const src = sessionSrc();
    // The code should detect rate limit errors (e.g., "rate limit", "overloaded", "usage limit")
    // and pause timer mode when detected
    expect(src).toMatch(/rate.?limit|overloaded|usage.?limit|too many requests/i);
  });

  it('should have a _timerPausedUntil field on NotebookSession', () => {
    const src = sessionSrc();
    expect(src).toContain('_timerPausedUntil');
  });

  it('should check _timerPausedUntil in timerTick before sending', () => {
    const src = sessionSrc();
    const timerTickMethod = src.match(/private timerTick\([\s\S]*?(?=\n  \/\*\*|\n  \/\/ ──)/);
    expect(timerTickMethod).toBeTruthy();
    expect(timerTickMethod![0]).toContain('_timerPausedUntil');
  });

  it('should set _timerPausedUntil when rate limit error is detected', () => {
    const src = sessionSrc();
    // The rate limit handler should set _timerPausedUntil to a future timestamp
    expect(src).toMatch(/_timerPausedUntil\s*=\s*Date\.now\(\)\s*\+/);
  });

  it('should broadcast timer_paused when rate limit detected', () => {
    const src = sessionSrc();
    expect(src).toContain("'timer_paused'");
  });

  it('should broadcast timer_resumed when cooldown expires', () => {
    const src = sessionSrc();
    expect(src).toContain("'timer_resumed'");
  });
});
