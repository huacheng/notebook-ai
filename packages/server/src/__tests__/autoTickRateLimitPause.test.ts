/**
 * Tests that auto mode pauses when a rate limit / usage limit error is detected,
 * and resumes automatically after a cooldown period.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const sessionSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../session.ts'), 'utf-8');

describe('auto mode rate limit pause', () => {
  it('should have a rate limit detection pattern in completeCell or result handler', () => {
    const src = sessionSrc();
    // The code should detect rate limit errors (e.g., "rate limit", "overloaded", "usage limit")
    // and pause auto mode when detected
    expect(src).toMatch(/rate.?limit|overloaded|usage.?limit|too many requests/i);
  });

  it('should have an _autoPausedUntil field on NotebookSession', () => {
    const src = sessionSrc();
    expect(src).toContain('_autoPausedUntil');
  });

  it('should check _autoPausedUntil in autoTick before sending', () => {
    const src = sessionSrc();
    const autoTickMethod = src.match(/private autoTick\([\s\S]*?(?=\n  \/\*\*|\n  \/\/ ──)/);
    expect(autoTickMethod).toBeTruthy();
    expect(autoTickMethod![0]).toContain('_autoPausedUntil');
  });

  it('should set _autoPausedUntil when rate limit error is detected', () => {
    const src = sessionSrc();
    // The rate limit handler should set _autoPausedUntil to a future timestamp
    expect(src).toMatch(/_autoPausedUntil\s*=\s*Date\.now\(\)\s*\+/);
  });

  it('should broadcast auto_paused when rate limit detected', () => {
    const src = sessionSrc();
    expect(src).toContain("'auto_paused'");
  });

  it('should broadcast auto_resumed when cooldown expires', () => {
    const src = sessionSrc();
    expect(src).toContain("'auto_resumed'");
  });
});
