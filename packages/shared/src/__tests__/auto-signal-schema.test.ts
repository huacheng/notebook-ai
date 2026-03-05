import { describe, it, expect } from 'vitest';
import { AutoSignalSchema, AutoStatusMessageSchema } from '../types';

describe('AutoSignalSchema', () => {
  it('validates full signal with all new fields', () => {
    const full = {
      step: 'exec',
      result: '(step-3)',
      next: 'verify',
      checkpoint: 'mid-exec',
      iteration: 5,
      compaction_count: 1,
      phase: 'execution',
      phase_progress: 0.45,
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
      delegation_failures: ['verify@iter3'],
      timestamp: '2026-01-01T00:00:00Z',
    };
    expect(AutoSignalSchema.parse(full)).toBeDefined();
  });

  it('rejects invalid phase value', () => {
    const bad = {
      step: 'check',
      result: 'PASS',
      next: 'exec',
      iteration: 1,
      timestamp: '2026-01-01T00:00:00Z',
      phase: 'invalid_phase',
    };
    expect(() => AutoSignalSchema.parse(bad)).toThrow();
  });

  it('rejects phase_progress out of range', () => {
    const bad = {
      step: 'check',
      result: 'PASS',
      next: 'exec',
      iteration: 1,
      timestamp: '2026-01-01T00:00:00Z',
      phase: 'execution',
      phase_progress: 1.5,
    };
    expect(() => AutoSignalSchema.parse(bad)).toThrow();
  });

  it('allows check_score to be null', () => {
    const signal = {
      step: 'exec',
      result: '(step-1)',
      next: 'exec',
      iteration: 1,
      timestamp: '2026-01-01T00:00:00Z',
      phase: 'execution',
      phase_progress: 0.1,
      check_score: null,
      retry_count: 0,
      delegation_failures: [],
    };
    expect(AutoSignalSchema.parse(signal)).toBeDefined();
  });
});

describe('AutoStatusMessageSchema', () => {
  it('validates auto_status WebSocket message', () => {
    const msg = {
      type: 'auto_status' as const,
      session_id: 'sess-123',
      phase: 'execution',
      phase_progress: 0.45,
      step: 'exec',
      next: 'verify',
      stage: { current: 2, total: 3 },
      check_score: null,
      retry_count: 0,
      iteration: 5,
    };
    expect(AutoStatusMessageSchema.parse(msg)).toBeDefined();
  });
});
