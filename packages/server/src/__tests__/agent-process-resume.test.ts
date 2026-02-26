import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as cp from 'child_process';
import { AgentProcess } from '../agent-process.js';

// Spy on spawn so we can inspect args and control the mock process.
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: vi.fn() };
});

const EventEmitter = require('events');

function createMockProc() {
  const proc = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.stdout = new EventEmitter();
  proc.stdout.pause = vi.fn();
  proc.stdout.resume = vi.fn();
  proc.stdout.setEncoding = vi.fn();
  proc.stdout[Symbol.asyncIterator] = undefined;
  proc.exitCode = null;
  proc.killed = false;
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

function emitLine(proc: any, line: string) {
  // readline reads 'data' events from stdout
  proc.stdout.emit('data', Buffer.from(line + '\n'));
}

describe('AgentProcess — claudeSessionId capture', () => {
  let mockProc: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProc = createMockProc();
    (cp.spawn as any).mockReturnValue(mockProc);
  });

  it('should start with claudeSessionId as null', () => {
    const ap = new AgentProcess('claude', '/tmp');
    expect(ap.getClaudeSessionId()).toBeNull();
  });

  it('should capture session_id from system.init message via onMessage', async () => {
    const ap = new AgentProcess('claude', '/tmp');
    const messages: unknown[] = [];

    const startPromise = ap.start((msg) => messages.push(msg));
    // Emit first line to resolve _waitForFirstOutput
    emitLine(mockProc, JSON.stringify({ type: 'system', subtype: 'hook_started' }));
    await startPromise;

    // Now emit the system.init message
    emitLine(mockProc, JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'abc-123-def',
    }));

    // Give readline time to process
    await new Promise((r) => setTimeout(r, 50));

    expect(ap.getClaudeSessionId()).toBe('abc-123-def');
  });

  it('should NOT capture session_id from non-init system messages', async () => {
    const ap = new AgentProcess('claude', '/tmp');

    const startPromise = ap.start(() => {});
    emitLine(mockProc, JSON.stringify({ type: 'system', subtype: 'hook_started' }));
    await startPromise;

    emitLine(mockProc, JSON.stringify({
      type: 'system',
      subtype: 'hook_completed',
      session_id: 'should-not-capture',
    }));

    await new Promise((r) => setTimeout(r, 50));

    expect(ap.getClaudeSessionId()).toBeNull();
  });
});

describe('AgentProcess — resume support', () => {
  let mockProc: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProc = createMockProc();
    (cp.spawn as any).mockReturnValue(mockProc);
  });

  it('should add --resume flag when resumeSessionId is provided', async () => {
    const ap = new AgentProcess('claude', '/tmp');
    const startPromise = ap.start(() => {}, undefined, 'session-to-resume');
    emitLine(mockProc, JSON.stringify({ type: 'system', subtype: 'hook_started' }));
    await startPromise;

    const args: string[] = (cp.spawn as any).mock.calls[0][1];
    expect(args).toContain('--resume');
    const resumeIdx = args.indexOf('--resume');
    expect(args[resumeIdx + 1]).toBe('session-to-resume');
  });

  it('should NOT add --resume flag when resumeSessionId is not provided', async () => {
    const ap = new AgentProcess('claude', '/tmp');
    const startPromise = ap.start(() => {});
    emitLine(mockProc, JSON.stringify({ type: 'system', subtype: 'hook_started' }));
    await startPromise;

    const args: string[] = (cp.spawn as any).mock.calls[0][1];
    expect(args).not.toContain('--resume');
  });
});
