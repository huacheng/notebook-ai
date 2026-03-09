import { describe, it, expect } from 'vitest';

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
});
