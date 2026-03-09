/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests that interruptCell() force-completes a stale running cell
 * when the agent process is dead (e.g., after server restart).
 *
 * Bug: interruptCell() sets _interrupted=true and calls agentProcess.interrupt(),
 * but if the process is dead, interrupt() silently no-ops and no 'result' message
 * ever arrives, leaving the cell stuck in 'running' forever.
 */

// Minimal mock types matching session.ts internals
interface MockCell {
  id: string;
  type: 'prompt';
  source: string;
  outputs: unknown[];
  status: string;
  execution_count: number;
}

interface MockNotebook {
  cells: MockCell[];
  metadata: { title: string; created: string; git_repo: boolean; agent: 'claude' };
  version: number;
  slide: { generated: boolean; sections: unknown[] };
  annotations: unknown[];
  assets: { intermediate_files: unknown[] };
}

function makeNotebook(cells: MockCell[]): MockNotebook {
  return {
    cells,
    metadata: { title: 'test', created: '', git_repo: false, agent: 'claude' },
    version: 1,
    slide: { generated: false, sections: [] },
    annotations: [],
    assets: { intermediate_files: [] },
  };
}

function makeRunningCell(id: string): MockCell {
  return { id, type: 'prompt', source: 'test', outputs: [], status: 'running', execution_count: 1 };
}

describe('interruptCell with dead process', () => {
  it('should force-complete the running cell when agent process is dead', async () => {
    // We import SessionManager dynamically to allow mocking
    const { SessionManager } = await import('../session.js');
    const mgr = new SessionManager();

    // Inject a fake session with a dead agent process
    const fakeSession = {
      id: 'test-session',
      notebook: makeNotebook([makeRunningCell('cell-1')]),
      notebookPath: '/tmp/test.notebook.json',
      cwd: '/tmp',
      agentProcess: {
        isAlive: () => false,
        interrupt: vi.fn(),
        engine: 'claude',
        model: undefined,
      },
      listeners: new Set<(msg: any) => void>(),
      _interrupted: false,
      _rerunQueue: undefined,
      _executeLock: Promise.resolve(),
      _execStartTimes: new Map(),
      _pendingToolUseIds: new Set(),
      _toolLongRunningNotified: false,
      _autoMode: false,
      _autoTimer: null,
      _autoIntervalMs: 300000,
      _autoIterationCount: 0,
      _autoExecuting: false,
      _autoPausedUntil: 0,
      _lastCellId: 'cell-1',
      _pendingPostComplete: Promise.resolve(),
      eventBuffer: {
        push: vi.fn().mockImplementation((msg: any) => ({ ...msg, event_index: 0 })),
        slice: vi.fn().mockReturnValue([]),
      },
      notebookDbId: undefined,
      claudeSessionId: undefined,
      gitManager: { tryCommit: vi.fn() },
      allowedDirs: undefined,
    };
    (mgr as any).sessions.set('test-session', fakeSession);

    // Capture broadcast messages
    const broadcasts: any[] = [];
    fakeSession.listeners.add((msg: any) => broadcasts.push(msg));

    // Act: interrupt the cell
    await mgr.interruptCell('test-session');

    // Assert: cell should be force-completed (not stuck in 'running')
    const cell = fakeSession.notebook.cells.find((c: any) => c.id === 'cell-1');
    expect(cell?.status).not.toBe('running');
    // Should be 'interrupted' since _interrupted was set
    expect(cell?.status).toBe('interrupted');

    // Assert: execution_complete should have been broadcast
    const completeMsg = broadcasts.find((m: any) => m.type === 'execution_complete');
    expect(completeMsg).toBeDefined();
    expect(completeMsg.cell_id).toBe('cell-1');
    expect(completeMsg.status).toBe('interrupted');
  });

  it('should still send SIGINT when agent process is alive', async () => {
    const { SessionManager } = await import('../session.js');
    const mgr = new SessionManager();

    const interruptFn = vi.fn();
    const fakeSession = {
      id: 'test-session-2',
      notebook: makeNotebook([makeRunningCell('cell-2')]),
      notebookPath: '/tmp/test2.notebook.json',
      cwd: '/tmp',
      agentProcess: {
        isAlive: () => true,
        interrupt: interruptFn,
        engine: 'claude',
        model: undefined,
      },
      listeners: new Set<(msg: any) => void>(),
      _interrupted: false,
      _rerunQueue: undefined,
      _executeLock: Promise.resolve(),
      _execStartTimes: new Map(),
      _pendingToolUseIds: new Set(),
      _toolLongRunningNotified: false,
      _autoMode: false,
      _autoTimer: null,
      _autoIntervalMs: 300000,
      _autoIterationCount: 0,
      _autoExecuting: false,
      _autoPausedUntil: 0,
      _lastCellId: 'cell-2',
      _pendingPostComplete: Promise.resolve(),
      eventBuffer: { push: vi.fn(), slice: vi.fn().mockReturnValue([]) },
      notebookDbId: undefined,
      claudeSessionId: undefined,
      gitManager: { tryCommit: vi.fn() },
      allowedDirs: undefined,
    };
    (mgr as any).sessions.set('test-session-2', fakeSession);

    await mgr.interruptCell('test-session-2');

    // Should call interrupt on the agent process
    expect(interruptFn).toHaveBeenCalled();
    // Cell should still be 'running' (waiting for result message from Claude)
    const cell = fakeSession.notebook.cells.find((c: any) => c.id === 'cell-2');
    expect(cell?.status).toBe('running');
    // _interrupted flag should be set for when result arrives
    expect(fakeSession._interrupted).toBe(true);
  });
});
