import { describe, it, expect } from 'vitest';

describe('TimerStopButton', () => {
  it('exports TimerStopButton component', async () => {
    const { TimerStopButton } = await import('../components/TimerStatusBar');
    expect(TimerStopButton).toBeDefined();
    expect(typeof TimerStopButton).toBe('function');
  });

  it('exports phase utilities', async () => {
    const { getPhaseIndex, PHASES, PHASE_MAP } = await import('../components/TimerStatusBar');
    expect(PHASES).toEqual(['target', 'plan', 'exec', 'merge']);
    expect(PHASE_MAP['execution']).toBe('exec');
    expect(getPhaseIndex('planning')).toBe(1);
    expect(getPhaseIndex(null)).toBe(-1);
  });
});

describe('IterationBadge', () => {
  it('exports IterationBadge component', async () => {
    const { IterationBadge } = await import('../components/TimerStatusBar');
    expect(IterationBadge).toBeDefined();
    expect(typeof IterationBadge).toBe('function');
  });
});

describe('RetryBadge', () => {
  it('exports RetryBadge component', async () => {
    const { RetryBadge } = await import('../components/TimerStatusBar');
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
