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

describe('IterationBadge', () => {
  it('exports IterationBadge component', async () => {
    const { IterationBadge } = await import('../components/AutoStatusBar');
    expect(IterationBadge).toBeDefined();
    expect(typeof IterationBadge).toBe('function');
  });
});

describe('RetryBadge', () => {
  it('exports RetryBadge component', async () => {
    const { RetryBadge } = await import('../components/AutoStatusBar');
    expect(RetryBadge).toBeDefined();
    expect(typeof RetryBadge).toBe('function');
  });
});

describe('task-auto API', () => {
  it('exports stopAutoMode, getAutoStatus, and startAutoMode', async () => {
    const { stopAutoMode, getAutoStatus, startAutoMode } = await import('../api/task-auto');
    expect(typeof stopAutoMode).toBe('function');
    expect(typeof getAutoStatus).toBe('function');
    expect(typeof startAutoMode).toBe('function');
  });
});
