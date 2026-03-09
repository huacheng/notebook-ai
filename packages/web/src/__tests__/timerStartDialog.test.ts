import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const dialogSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../components/TimerStartDialog.tsx'), 'utf-8');

describe('TimerStartDialog', () => {
  it('exports TimerStartDialog component', async () => {
    const { TimerStartDialog } = await import('../components/TimerStartDialog');
    expect(TimerStartDialog).toBeDefined();
    expect(typeof TimerStartDialog).toBe('function');
  });

  it('exports DEFAULT_MAX_ITERATIONS and DEFAULT_TIMEOUT_MINUTES', async () => {
    const { DEFAULT_MAX_ITERATIONS, DEFAULT_TIMEOUT_MINUTES } = await import('../components/TimerStartDialog');
    expect(DEFAULT_MAX_ITERATIONS).toBe(20);
    expect(DEFAULT_TIMEOUT_MINUTES).toBe(30);
  });

  it('exports DEFAULT_INTERVAL_SECONDS', async () => {
    const mod = await import('../components/TimerStartDialog');
    expect(mod.DEFAULT_INTERVAL_SECONDS).toBe(300);
  });

  it('onStart callback receives intervalSeconds parameter', () => {
    const src = dialogSrc();
    // onStart should accept intervalSeconds
    expect(src).toMatch(/onStart.*intervalSeconds/);
  });

  it('has an interval input field in the dialog', () => {
    const src = dialogSrc();
    // Should have an input for interval
    expect(src).toContain('intervalSeconds');
    expect(src).toContain('setIntervalSeconds');
  });
});

describe('TimerToggleButton sends interval_ms', () => {
  it('should pass interval_ms in timer_start WS message', () => {
    const notebookSrc = fs.readFileSync(
      path.resolve(__dirname, '../components/Notebook.tsx'), 'utf-8'
    );
    // timer_start message should include interval_ms
    expect(notebookSrc).toMatch(/timer_start.*interval_ms/s);
  });
});
