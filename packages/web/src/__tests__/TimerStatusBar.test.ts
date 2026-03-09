import { describe, it, expect } from 'vitest';

describe('TimerStatusBar helpers', () => {
  it('exports PHASES and PHASE_MAP with correct mapping', async () => {
    const { PHASES, PHASE_MAP } = await import('../components/TimerStatusBar');
    expect(PHASES).toEqual(['target', 'plan', 'exec', 'merge']);
    expect(PHASE_MAP['target']).toBe('target');
    expect(PHASE_MAP['planning']).toBe('plan');
    expect(PHASE_MAP['execution']).toBe('exec');
    expect(PHASE_MAP['finalization']).toBe('merge');
  });

  it('getPhaseIndex returns correct index for each phase', async () => {
    const { getPhaseIndex } = await import('../components/TimerStatusBar');
    expect(getPhaseIndex('target')).toBe(0);
    expect(getPhaseIndex('planning')).toBe(1);
    expect(getPhaseIndex('execution')).toBe(2);
    expect(getPhaseIndex('finalization')).toBe(3);
    expect(getPhaseIndex(null)).toBe(-1);
    expect(getPhaseIndex('unknown')).toBe(-1);
  });

  it('D_LABELS has entries for all six dimensions', async () => {
    const { D_LABELS } = await import('../components/TimerStatusBar');
    expect(Object.keys(D_LABELS)).toHaveLength(6);
    expect(D_LABELS['d1_correctness']).toBeDefined();
    expect(D_LABELS['d6_maintainability']).toBeDefined();
  });
});
