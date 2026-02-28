import { describe, it, expect } from 'vitest';
import { estimateTokens, getStatusLabel } from '../utils/runningStatus';

// ── estimateTokens ──────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('input includes prompt source chars', () => {
    const result = estimateTokens('hello world', [], undefined);
    expect(result.input).toBeGreaterThanOrEqual(1);
  });

  it('input includes tool result content', () => {
    const outputs = [
      { type: 'tool_use' as const, name: 'bash', input: {}, result: 'x'.repeat(400) },
    ];
    const result = estimateTokens('', outputs, undefined);
    expect(result.input).toBe(Math.floor(400 / 4));
  });

  it('output includes stream text and thinking', () => {
    const buf = { text: 'a'.repeat(100), thinking: 'b'.repeat(200) };
    const result = estimateTokens('', [], buf);
    expect(result.output).toBe(Math.floor(300 / 4));
  });

  it('output includes completed text outputs', () => {
    const outputs = [
      { type: 'text' as const, content: 'c'.repeat(80) },
    ];
    const result = estimateTokens('', outputs, undefined);
    expect(result.output).toBe(Math.floor(80 / 4));
  });

  it('output includes tool_use input JSON', () => {
    const toolInput = { file_path: '/foo/bar.ts', content: 'hello' };
    const outputs = [
      { type: 'tool_use' as const, name: 'write', input: toolInput },
    ];
    const result = estimateTokens('', outputs, undefined);
    expect(result.output).toBe(Math.floor(JSON.stringify(toolInput).length / 4));
  });

  it('returns zero for empty inputs', () => {
    const result = estimateTokens('', [], undefined);
    expect(result.input).toBe(0);
    expect(result.output).toBe(0);
  });
});

// ── getStatusLabel ──────────────────────────────────────────────────────────

describe('getStatusLabel', () => {
  it('returns "Thinking…" when isThinking', () => {
    expect(getStatusLabel(true, true, 10)).toBe('Thinking…');
  });

  it('returns "Processing…" when no output and elapsed >5s', () => {
    expect(getStatusLabel(false, false, 6)).toBe('Processing…');
  });

  it('returns "Running…" when output exists', () => {
    expect(getStatusLabel(false, true, 6)).toBe('Running…');
  });

  it('returns "Running…" when no output but elapsed <5s', () => {
    expect(getStatusLabel(false, false, 3)).toBe('Running…');
  });
});
