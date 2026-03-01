/**
 * Tests for tool_result_response: AgentProcess.sendToolResult + SessionManager.submitToolResult
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as cp from 'child_process';
import { AgentProcess } from '../agent-process.js';
import { SessionManager } from '../session.js';

// ── Mock child_process ──────────────────────────────────────────────────────
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
  proc.stdout.emit('data', Buffer.from(line + '\n'));
}

// ── AgentProcess.sendToolResult ─────────────────────────────────────────────

describe('AgentProcess.sendToolResult', () => {
  let mockProc: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProc = createMockProc();
    (cp.spawn as any).mockReturnValue(mockProc);
  });

  it('writes correct stream-json tool_result to stdin', async () => {
    const ap = new AgentProcess('claude', '/tmp');
    const startPromise = ap.start(() => {});
    emitLine(mockProc, JSON.stringify({ type: 'system', subtype: 'hook_started' }));
    await startPromise;

    ap.sendToolResult('toolu_01abc', 'Python');

    expect(mockProc.stdin.write).toHaveBeenCalledTimes(1);
    const written = mockProc.stdin.write.mock.calls[0][0];
    const parsed = JSON.parse(written.replace(/\n$/, ''));
    expect(parsed).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_01abc',
          content: 'Python',
          is_error: false,
        }],
      },
    });
  });

  it('throws when process is not running', () => {
    const ap = new AgentProcess('claude', '/tmp');
    expect(() => ap.sendToolResult('toolu_01', 'answer')).toThrow('process is not running');
  });

  it('throws for non-claude engine', async () => {
    const ap = new AgentProcess('gemini', '/tmp');
    const startPromise = ap.start(() => {});
    emitLine(mockProc, JSON.stringify({ type: 'system', subtype: 'hook_started' }));
    await startPromise;

    expect(() => ap.sendToolResult('toolu_01', 'answer')).toThrow('only supported for Claude');
  });
});

// ── SessionManager.submitToolResult ─────────────────────────────────────────

describe('SessionManager.submitToolResult', () => {
  let startSpy: ReturnType<typeof vi.spyOn>;
  let stopSpy: ReturnType<typeof vi.spyOn>;
  let ensureRepoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { AgentProcess } = await import('../agent-process.js');
    startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg) => {
      (onMsg as Function)({ type: 'system', subtype: 'hook_started' });
    });
    stopSpy = vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(() => {});
    const { GitManager } = await import('../git.js');
    ensureRepoSpy = vi.spyOn(GitManager.prototype, 'ensureRepo').mockResolvedValue();
  });

  afterEach(() => {
    startSpy.mockRestore();
    stopSpy.mockRestore();
    ensureRepoSpy.mockRestore();
  });

  it('routes to correct session and calls agentProcess.sendToolResult', async () => {
    const sm = new SessionManager();
    const session = await sm.createSession('/tmp/test.notebook.json', '/tmp');

    const spy = vi.spyOn(session.agentProcess, 'sendToolResult').mockImplementation(() => {});

    await sm.submitToolResult(session.id, 'toolu_abc', 'User chose Python');

    expect(spy).toHaveBeenCalledWith('toolu_abc', 'User chose Python');
  });

  it('throws for unknown session', async () => {
    const sm = new SessionManager();
    await expect(
      sm.submitToolResult('nonexistent-session', 'toolu_abc', 'answer'),
    ).rejects.toThrow('not found');
  });
});
