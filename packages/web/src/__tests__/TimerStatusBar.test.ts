import { describe, it, expect } from 'vitest';

describe('TimerStatusBar helpers', () => {
  it('exports PHASES with correct lifecycle steps', async () => {
    const { PHASES } = await import('../components/TimerStatusBar');
    expect(PHASES).toEqual(['target', 'plan', 'exec', 'merge']);
  });

  it('getPhaseIndex returns correct index for lifecycle statuses', async () => {
    const { getPhaseIndex } = await import('../components/TimerStatusBar');
    expect(getPhaseIndex('draft')).toBe(0);
    expect(getPhaseIndex('planning')).toBe(1);
    expect(getPhaseIndex('re-planning')).toBe(1);
    expect(getPhaseIndex('review')).toBe(1);
    expect(getPhaseIndex('executing')).toBe(2);
    expect(getPhaseIndex('evolving')).toBe(2);
    expect(getPhaseIndex('merging')).toBe(3);
    expect(getPhaseIndex('satisfied')).toBe(3);
    expect(getPhaseIndex(null)).toBe(-1);
    expect(getPhaseIndex('blocked')).toBe(-1);
    expect(getPhaseIndex('cancelled')).toBe(-1);
    expect(getPhaseIndex('unknown')).toBe(-1);
  });

  it('isPhaseComplete correctly identifies completed phases', async () => {
    const { isPhaseComplete } = await import('../components/TimerStatusBar');
    // draft: nothing complete
    expect(isPhaseComplete(0, 'draft')).toBe(false);
    // planning: target (0) complete
    expect(isPhaseComplete(0, 'planning')).toBe(true);
    expect(isPhaseComplete(1, 'planning')).toBe(false);
    // review: target + plan complete
    expect(isPhaseComplete(0, 'review')).toBe(true);
    expect(isPhaseComplete(1, 'review')).toBe(true);
    expect(isPhaseComplete(2, 'review')).toBe(false);
    // executing: target + plan complete
    expect(isPhaseComplete(0, 'executing')).toBe(true);
    expect(isPhaseComplete(1, 'executing')).toBe(true);
    expect(isPhaseComplete(2, 'executing')).toBe(false);
    // satisfied: all complete
    expect(isPhaseComplete(0, 'satisfied')).toBe(true);
    expect(isPhaseComplete(3, 'satisfied')).toBe(true);
  });

  it('D_LABELS has entries for all six dimensions', async () => {
    const { D_LABELS } = await import('../components/TimerStatusBar');
    expect(Object.keys(D_LABELS)).toHaveLength(6);
    expect(D_LABELS['d1_correctness']).toBeDefined();
    expect(D_LABELS['d6_maintainability']).toBeDefined();
  });
});
