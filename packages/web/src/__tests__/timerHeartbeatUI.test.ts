/**
 * Tests for the Timer heartbeat UI in Notebook.tsx.
 * RED: [Timer] button in statusbar, Esc stops timer mode.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const notebookSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../components/Notebook.tsx'), 'utf-8');

const wsSliceSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../store/wsSlice.ts'), 'utf-8');

describe('Timer heartbeat UI', () => {
  it('should have [Timer] toggle button in NotebookStatusBar', () => {
    const src = notebookSrc();
    // Should have a Timer button
    expect(src).toMatch(/timer.*btn|timer-toggle|timerMode/i);
  });

  it('interruptCell should send timer_stop when timer is active', () => {
    const src = wsSliceSrc();
    // interruptCell should check timerMode and send timer_stop
    const interruptSection = src.match(/interruptCell[\s\S]*?timer_stop/);
    expect(interruptSection).toBeTruthy();
  });

  it('should have timer interval state in store', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../store/autoStatusSlice.ts'), 'utf-8'
    );
    expect(src).toContain('timerMode');
    expect(src).toContain('timerIterationCount');
  });
});
