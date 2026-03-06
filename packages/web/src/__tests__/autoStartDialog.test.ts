import { describe, it, expect } from 'vitest';

describe('AutoStartDialog', () => {
  it('exports AutoStartDialog component', async () => {
    const { AutoStartDialog } = await import('../components/AutoStartDialog');
    expect(AutoStartDialog).toBeDefined();
    expect(typeof AutoStartDialog).toBe('function');
  });

  it('exports DEFAULT_MAX_ITERATIONS and DEFAULT_TIMEOUT_MINUTES', async () => {
    const { DEFAULT_MAX_ITERATIONS, DEFAULT_TIMEOUT_MINUTES } = await import('../components/AutoStartDialog');
    expect(DEFAULT_MAX_ITERATIONS).toBe(20);
    expect(DEFAULT_TIMEOUT_MINUTES).toBe(30);
  });
});
