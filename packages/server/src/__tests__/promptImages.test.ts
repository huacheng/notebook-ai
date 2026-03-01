import { describe, it, expect, vi } from 'vitest';
import {
  PromptImageSchema,
  PromptCellSchema,
  ExecuteRequestSchema,
  type PromptImage,
} from '@notebook-ai/shared';
import { AgentProcess } from '../agent-process.js';

// ── Schema tests ──────────────────────────────────────────────────────────────

describe('PromptImageSchema', () => {
  const validImage = { media_type: 'image/png', data: 'abc123' };

  it('validates a valid image', () => {
    const result = PromptImageSchema.safeParse(validImage);
    expect(result.success).toBe(true);
  });

  it('rejects missing data', () => {
    const result = PromptImageSchema.safeParse({ media_type: 'image/png' });
    expect(result.success).toBe(false);
  });
});

describe('PromptCellSchema with images', () => {
  const baseCell = {
    id: 'c1',
    type: 'prompt' as const,
    source: 'hello',
    outputs: [],
  };
  const validImage = { media_type: 'image/png', data: 'abc123' };

  it('accepts cell with images', () => {
    const result = PromptCellSchema.safeParse({ ...baseCell, images: [validImage] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.images).toHaveLength(1);
    }
  });

  it('accepts cell without images (backward compat)', () => {
    const result = PromptCellSchema.safeParse(baseCell);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.images).toBeUndefined();
    }
  });
});

describe('ExecuteRequestSchema with images', () => {
  const baseReq = {
    type: 'execute_request' as const,
    session_id: 's1',
    cell_id: 'c1',
    source: 'describe this',
  };
  const validImage = { media_type: 'image/png', data: 'abc123' };

  it('accepts request with images', () => {
    const result = ExecuteRequestSchema.safeParse({ ...baseReq, images: [validImage] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.images).toHaveLength(1);
    }
  });

  it('accepts request without images (backward compat)', () => {
    const result = ExecuteRequestSchema.safeParse(baseReq);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.images).toBeUndefined();
    }
  });
});

// ── sendPrompt image support tests ────────────────────────────────────────────

describe('AgentProcess.sendPrompt with images', () => {
  function makeProcess(): AgentProcess {
    const proc = new AgentProcess('claude', '/tmp');
    // Inject a fake proc with a writable stdin
    const written: string[] = [];
    const fakeStdin = { write: (data: string) => { written.push(data); return true; } };
    const fakeProc = { stdin: fakeStdin, exitCode: null, killed: false };
    (proc as any).proc = fakeProc;
    return Object.assign(proc, { _written: written });
  }

  it('sends string content when no images', () => {
    const proc = makeProcess() as AgentProcess & { _written: string[] };
    proc.sendPrompt('hello');
    const parsed = JSON.parse(proc._written[0].trim());
    expect(parsed.message.content).toBe('hello');
  });

  it('sends content array when images provided', () => {
    const proc = makeProcess() as AgentProcess & { _written: string[] };
    const images: PromptImage[] = [{ media_type: 'image/png', data: 'abc123' }];
    proc.sendPrompt('describe', images);
    const parsed = JSON.parse(proc._written[0].trim());
    expect(Array.isArray(parsed.message.content)).toBe(true);
    expect(parsed.message.content[0]).toEqual({ type: 'text', text: 'describe' });
    expect(parsed.message.content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
    });
  });

  it('sends string content when images array is empty', () => {
    const proc = makeProcess() as AgentProcess & { _written: string[] };
    proc.sendPrompt('hello', []);
    const parsed = JSON.parse(proc._written[0].trim());
    expect(parsed.message.content).toBe('hello');
  });
});
