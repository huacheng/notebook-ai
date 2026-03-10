/**
 * Test: PhaseProgressBar should display .status.json status directly
 * as a simple label — no 4-step progress bar, no PHASE_MAP.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const timerSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../components/TimerStatusBar.tsx'), 'utf-8');

describe('PhaseProgressBar displays status directly', () => {
  it('should NOT render PHASES as a 4-step progress bar', () => {
    const src = timerSrc();
    // PhaseProgressBar should not iterate over PHASES
    const fnBody = src.slice(src.indexOf('function PhaseProgressBar'), src.indexOf('function PhaseProgressBar') + 600);
    expect(fnBody).not.toMatch(/PHASES\.map/);
  });

  it('should render the status string directly', () => {
    const src = timerSrc();
    const fnBody = src.slice(src.indexOf('function PhaseProgressBar'), src.indexOf('function PhaseProgressBar') + 600);
    // Should display {status} directly
    expect(fnBody).toContain('{status}');
  });

  it('should show completedSteps when available', () => {
    const src = timerSrc();
    const fnBody = src.slice(src.indexOf('function PhaseProgressBar'), src.indexOf('function PhaseProgressBar') + 600);
    expect(fnBody).toMatch(/completedSteps/);
  });
});
