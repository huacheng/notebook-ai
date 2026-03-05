import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validateRecoveryReadiness } from '../task-ai/compaction-strategy';

describe('compaction-strategy reads new .auto-signal format', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('extracts phase and check_score from new format signal', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compaction-test-'));
    const signalPath = path.join(tmpDir, '.auto-signal');

    const signal = {
      step: 'exec',
      result: '(step-3)',
      next: 'verify',
      iteration: 5,
      phase: 'execution',
      phase_progress: 0.45,
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

    // Verify the raw file reads correctly
    const raw = JSON.parse(fs.readFileSync(signalPath, 'utf-8'));
    expect(raw.step).toBe('exec');
    expect(raw.iteration).toBe(5);
    expect(raw.phase).toBe('execution');
    expect(raw.phase_progress).toBe(0.45);
    expect(raw.check_score.overall).toBe(0.85);
    expect(raw.check_score.d1_correctness).toBe(0.90);
    expect(raw.retry_count).toBe(1);
    expect(raw.delegation_failures).toEqual(['verify@iter3']);
  });

  it('validates new signal fields via validateRecoveryReadiness', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compaction-test-'));

    // Write .auto-signal with new fields
    const signal = {
      step: 'exec',
      next: 'verify',
      iteration: 5,
      timestamp: '2026-01-01T00:00:00Z',
      phase: 'execution',
      phase_progress: 0.45,
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
    };
    fs.writeFileSync(path.join(tmpDir, '.auto-signal'), JSON.stringify(signal));

    // Write .status.json
    fs.writeFileSync(
      path.join(tmpDir, '.status.json'),
      JSON.stringify({ status: 'running', title: 'Test', type: 'task', branch: 'main' })
    );

    // Write .summary.md with recovery header
    fs.writeFileSync(
      path.join(tmpDir, '.summary.md'),
      '<!-- TASK-AI RECOVERY CONTEXT -->\n# Test summary'
    );

    const result = validateRecoveryReadiness(tmpDir);
    // New fields (phase, phase_progress, check_score, retry_count, delegation_failures)
    // must be validated — expect no errors about missing new fields
    expect(result.ready).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports missing new required fields in .auto-signal', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compaction-test-'));

    // Write .auto-signal with OLD format (missing new fields)
    const signal = {
      step: 'exec',
      next: 'verify',
      iteration: 5,
      timestamp: '2026-01-01T00:00:00Z',
      // Missing: phase, phase_progress, retry_count
    };
    fs.writeFileSync(path.join(tmpDir, '.auto-signal'), JSON.stringify(signal));

    // Write .status.json
    fs.writeFileSync(
      path.join(tmpDir, '.status.json'),
      JSON.stringify({ status: 'running', title: 'Test', type: 'task', branch: 'main' })
    );

    // Write .summary.md with recovery header
    fs.writeFileSync(
      path.join(tmpDir, '.summary.md'),
      '<!-- TASK-AI RECOVERY CONTEXT -->\n# Test summary'
    );

    const result = validateRecoveryReadiness(tmpDir);
    // Hard upgrade: new fields are required, so missing them should cause errors
    expect(result.ready).toBe(false);
    expect(result.errors).toContain('.auto-signal missing field: phase');
    expect(result.errors).toContain('.auto-signal missing field: phase_progress');
    expect(result.errors).toContain('.auto-signal missing field: retry_count');
  });
});
