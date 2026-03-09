import { describe, it, expect } from 'vitest';

describe('autoStatusSlice', () => {
  it('initializes with null timer status', async () => {
    const { initialAutoStatus } = await import('../store/autoStatusSlice');
    expect(initialAutoStatus.phase).toBeNull();
    expect(initialAutoStatus.phaseProgress).toBeNull();
    expect(initialAutoStatus.step).toBeNull();
    expect(initialAutoStatus.next).toBeNull();
    expect(initialAutoStatus.stage).toBeNull();
    expect(initialAutoStatus.checkScore).toBeNull();
    expect(initialAutoStatus.retryCount).toBe(0);
    expect(initialAutoStatus.iteration).toBe(0);
  });

  it('updates timer status from WebSocket message', async () => {
    const { applyAutoStatus, initialAutoStatus } = await import('../store/autoStatusSlice');

    const msg = {
      type: 'auto_status' as const,
      session_id: 'sess-123',
      phase: 'execution' as const,
      phase_progress: 0.45,
      step: 'exec',
      next: 'verify',
      stage: { current: 2, total: 3 },
      check_score: {
        overall: 0.85,
        d1_correctness: 0.90,
        d2_security: 0.80,
        d3_reliability: 0.85,
        d4_performance: 0.88,
        d5_architecture: 0.82,
        d6_maintainability: 0.85,
      },
      retry_count: 1,
      iteration: 5,
    };

    const updated = applyAutoStatus(initialAutoStatus, msg);
    expect(updated.phase).toBe('execution');
    expect(updated.phaseProgress).toBe(0.45);
    expect(updated.step).toBe('exec');
    expect(updated.next).toBe('verify');
    expect(updated.stage).toEqual({ current: 2, total: 3 });
    expect(updated.checkScore?.overall).toBe(0.85);
    expect(updated.checkScore?.d1_correctness).toBe(0.90);
    expect(updated.retryCount).toBe(1);
    expect(updated.iteration).toBe(5);
  });

  it('clears timer status when phase is null', async () => {
    const { applyAutoStatus } = await import('../store/autoStatusSlice');
    const prev = {
      phase: 'execution' as const,
      phaseProgress: 0.45,
      step: 'exec',
      next: 'verify',
      stage: { current: 2, total: 3 },
      checkScore: { overall: 0.85, d1_correctness: 0.90, d2_security: 0.80, d3_reliability: 0.85, d4_performance: 0.88, d5_architecture: 0.82, d6_maintainability: 0.85 },
      retryCount: 1,
      iteration: 5,
    };

    const msg = {
      type: 'auto_status' as const,
      session_id: 'sess-123',
      phase: null,
      phase_progress: null,
      step: null,
      next: null,
      stage: null,
      check_score: null,
      retry_count: 0,
      iteration: 0,
    };

    const updated = applyAutoStatus(prev, msg);
    expect(updated.phase).toBeNull();
    expect(updated.phaseProgress).toBeNull();
    expect(updated.checkScore).toBeNull();
    expect(updated.retryCount).toBe(0);
  });
});
