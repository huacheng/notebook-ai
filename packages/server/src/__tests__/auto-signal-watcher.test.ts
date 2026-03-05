import { describe, it, expect } from 'vitest';
import { AutoSignalSchema } from '@notebook-ai/shared';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Auto signal file parsing', () => {
  it('parses .auto-signal file with extended fields', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-signal-test-'));
    const signalPath = path.join(tmpDir, '.auto-signal');

    const signal = {
      step: 'check',
      result: 'PASS',
      next: 'exec',
      checkpoint: 'post-plan',
      iteration: 3,
      phase: 'planning',
      phase_progress: 0.75,
      stage: { current: 1, total: 2 },
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

    fs.writeFileSync(signalPath, JSON.stringify(signal));

    const raw = JSON.parse(fs.readFileSync(signalPath, 'utf-8'));
    const parsed = AutoSignalSchema.parse(raw);

    expect(parsed.phase).toBe('planning');
    expect(parsed.check_score?.overall).toBe(0.85);
    expect(parsed.stage?.current).toBe(1);
    expect(parsed.retry_count).toBe(1);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('constructs auto_status message from parsed signal', () => {
    const signal = {
      step: 'exec',
      result: '(step-3)',
      next: 'verify',
      iteration: 5,
      phase: 'execution' as const,
      phase_progress: 0.45,
      stage: { current: 2, total: 3 },
      check_score: null,
      retry_count: 0,
      delegation_failures: [],
      timestamp: '2026-01-01T00:00:00Z',
    };

    const parsed = AutoSignalSchema.parse(signal);

    // Construct the auto_status message the way ws-handler will
    const msg = {
      type: 'auto_status' as const,
      session_id: 'test-session',
      phase: parsed.phase,
      phase_progress: parsed.phase_progress,
      step: parsed.step,
      next: parsed.next,
      stage: parsed.stage ?? null,
      check_score: parsed.check_score ?? null,
      retry_count: parsed.retry_count,
      iteration: parsed.iteration,
    };

    expect(msg.type).toBe('auto_status');
    expect(msg.phase).toBe('execution');
    expect(msg.phase_progress).toBe(0.45);
    expect(msg.check_score).toBeNull();
  });
});
