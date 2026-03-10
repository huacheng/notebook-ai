/**
 * Test: PhaseProgressBar should derive phase directly from .status.json status
 * without a PHASE_MAP lookup table.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const timerSrc = () =>
  fs.readFileSync(path.resolve(__dirname, '../components/TimerStatusBar.tsx'), 'utf-8');

describe('PhaseProgressBar uses .status.json status directly', () => {
  it('should NOT have a PHASE_MAP lookup table', () => {
    const src = timerSrc();
    expect(src).not.toMatch(/PHASE_MAP/);
  });

  it('getPhaseIndex should handle all lifecycle statuses via switch', () => {
    const src = timerSrc();
    // Should handle: draft, planning, re-planning, review, executing, evolving, merging, satisfied, blocked, cancelled
    expect(src).toContain("case 'draft':");
    expect(src).toContain("case 'planning':");
    expect(src).toContain("case 're-planning':");
    expect(src).toContain("case 'review':");
    expect(src).toContain("case 'executing':");
    expect(src).toContain("case 'satisfied':");
    expect(src).toContain("case 'blocked':");
    expect(src).toContain("case 'cancelled':");
  });

  it('PhaseProgressBar should accept completedSteps prop', () => {
    const src = timerSrc();
    expect(src).toMatch(/completedSteps/);
  });
});
