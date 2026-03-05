import { describe, it, expect } from 'vitest';

describe('AutoStopButton', () => {
  it('exports AutoStopButton component', async () => {
    const { AutoStopButton } = await import('../components/AutoStatusBar');
    expect(AutoStopButton).toBeDefined();
    expect(typeof AutoStopButton).toBe('function');
  });

  it('exports phase utilities', async () => {
    const { getPhaseIndex, PHASES, PHASE_MAP } = await import('../components/AutoStatusBar');
    expect(PHASES).toEqual(['target', 'plan', 'exec', 'merge']);
    expect(PHASE_MAP['execution']).toBe('exec');
    expect(getPhaseIndex('planning')).toBe(1);
    expect(getPhaseIndex(null)).toBe(-1);
  });
});

describe('task-auto API', () => {
  it('exports stopAutoMode and getAutoStatus', async () => {
    const { stopAutoMode, getAutoStatus } = await import('../api/task-auto');
    expect(typeof stopAutoMode).toBe('function');
    expect(typeof getAutoStatus).toBe('function');
  });
});
