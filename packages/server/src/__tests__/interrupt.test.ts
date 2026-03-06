/**
 * Interrupt (Esc) tests — TDD Red phase.
 *
 * Tests:
 * 1. AgentProcess.interrupt() sends SIGINT to a running process
 * 2. AgentProcess.interrupt() no-ops on a dead/null process
 * 3. SessionManager.interruptCell() calls agent's interrupt()
 * 4. SessionManager.interruptCell() clears _rerunQueue
 * 5. SessionManager.interruptCell() throws for non-existent session
 * 6. After interrupt, Claude result message completes the cell
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../session.js';
import { NotebookStore } from '../notebook-store.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('interrupt (Esc)', () => {
  let sm: SessionManager;
  let ns: NotebookStore;
  let tempDir: string;
  let startSpy: ReturnType<typeof vi.spyOn>;
  let stopSpy: ReturnType<typeof vi.spyOn>;
  let sendPromptSpy: ReturnType<typeof vi.spyOn>;
  let interruptSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    sm = new SessionManager();
    ns = new NotebookStore();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interrupt-test-'));

    const { AgentProcess } = await import('../agent-process.js');
    startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg) => {
      onMsg({ type: 'system', subtype: 'hook_started' });
    });
    stopSpy = vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(() => {});
    sendPromptSpy = vi.spyOn(AgentProcess.prototype, 'sendPrompt').mockImplementation(() => {});
    interruptSpy = vi.spyOn(AgentProcess.prototype, 'interrupt').mockImplementation(() => {});
  });

  afterEach(() => {
    startSpy.mockRestore();
    stopSpy.mockRestore();
    sendPromptSpy.mockRestore();
    interruptSpy.mockRestore();
  });

  async function createSessionWithRunningCell() {
    const nbPath = path.join(tempDir, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Test', tempDir));

    const session = await sm.createSession(nbPath, tempDir);

    // Add a running cell
    session.notebook = {
      ...session.notebook,
      cells: [
        {
          id: 'c1', type: 'prompt' as const, source: 'hello',
          outputs: [], execution_count: 1, status: 'running' as const,
        },
        {
          id: 'c2', type: 'prompt' as const, source: 'world',
          outputs: [], execution_count: 0, status: 'pending' as const,
        },
      ],
    };

    return session;
  }

  // ── AgentProcess.interrupt() ────────────────────────────────────────────

  it('AgentProcess.interrupt() exists as a method', async () => {
    const { AgentProcess } = await import('../agent-process.js');
    const ap = new AgentProcess('claude', '/tmp');
    expect(typeof ap.interrupt).toBe('function');
  });

  it('isAlive() returns true after SIGINT (proc.killed is true but exitCode is null)', async () => {
    // This test verifies the bug fix: SIGINT sets proc.killed=true but doesn't
    // terminate the process. isAlive() should still return true.
    const { AgentProcess } = await import('../agent-process.js');
    const ap = new AgentProcess('claude', '/tmp');

    // Mock a process that received SIGINT but is still running
    const mockProc = { exitCode: null, killed: true } as any;
    (ap as any).proc = mockProc;

    // isAlive() should return true because exitCode is still null
    expect(ap.isAlive()).toBe(true);
  });

  it('isAlive() returns false only when exitCode is set', async () => {
    const { AgentProcess } = await import('../agent-process.js');
    const ap = new AgentProcess('claude', '/tmp');

    // Process truly exited
    const mockProc = { exitCode: 0, killed: true } as any;
    (ap as any).proc = mockProc;

    expect(ap.isAlive()).toBe(false);
  });

  // ── SessionManager.interruptCell() ──────────────────────────────────────

  it('interruptCell() calls agent interrupt() and sets _interrupted flag', async () => {
    const session = await createSessionWithRunningCell();
    // Mock isAlive to return true (mocked start() doesn't set proc)
    const isAliveSpy = vi.spyOn(session.agentProcess, 'isAlive').mockReturnValue(true);

    await sm.interruptCell(session.id);

    expect(interruptSpy).toHaveBeenCalledTimes(1);
    expect((session as any)._interrupted).toBe(true);

    isAliveSpy.mockRestore();
  });

  it('interruptCell() clears _rerunQueue', async () => {
    const session = await createSessionWithRunningCell();
    const isAliveSpy = vi.spyOn(session.agentProcess, 'isAlive').mockReturnValue(true);
    // Simulate an active rerun queue
    (session as any)._rerunQueue = ['c2'];

    await sm.interruptCell(session.id);

    expect((session as any)._rerunQueue).toBeUndefined();

    isAliveSpy.mockRestore();
  });

  it('interruptCell() throws for non-existent session', async () => {
    await expect(sm.interruptCell('non-existent')).rejects.toThrow(
      'Session "non-existent" not found',
    );
  });

  // ── Auto-restart after process death ────────────────────────────────────

  it('executeCell auto-restarts dead process after interrupt', async () => {
    let onMessage: (msg: unknown) => void = () => {};
    startSpy.mockImplementation(async (onMsg: (msg: unknown) => void) => {
      onMessage = onMsg;
      onMsg({ type: 'system', subtype: 'hook_started' });
    });

    const session = await createSessionWithRunningCell();

    // Simulate: interrupt kills the process → isAlive() returns false
    const isAliveSpy = vi.spyOn(session.agentProcess, 'isAlive').mockReturnValue(false);

    // Set _interrupted flag (normally done by interruptCell)
    (session as any)._interrupted = true;

    // Complete the running cell first so we can execute a new one
    onMessage({ type: 'result', result: 'interrupted', is_error: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(session.notebook.cells[0].status).toBe('interrupted');

    // Now try to execute a new prompt — should auto-restart, not throw
    await sm.executeCell(session.id, 'c3', '继续');

    // start() should have been called again (restart)
    expect(startSpy).toHaveBeenCalledTimes(2); // 1st: createSession, 2nd: auto-restart
    // Auto-restart should NOT pass resumeSessionId (3rd arg should be undefined)
    const restartCall = startSpy.mock.calls[1];
    expect(restartCall[2]).toBeUndefined(); // no --resume for crashed session
    // sendPrompt should succeed on the restarted process
    expect(sendPromptSpy).toHaveBeenCalledWith('继续');

    isAliveSpy.mockRestore();
  });

  it('executeCell force-completes stale running cell when process is dead', async () => {
    startSpy.mockImplementation(async (onMsg: (msg: unknown) => void) => {
      onMsg({ type: 'system', subtype: 'hook_started' });
    });

    const session = await createSessionWithRunningCell();

    // Simulate: process died but cell is still "running" (race condition)
    const isAliveSpy = vi.spyOn(session.agentProcess, 'isAlive').mockReturnValue(false);
    // Note: we do NOT send a result message — cell c1 stays "running"
    expect(session.notebook.cells[0].status).toBe('running');

    // executeCell should NOT throw "Another cell is already running"
    await sm.executeCell(session.id, 'c3', '继续');

    // Stale running cell should have been force-completed
    // (no _interrupted flag, so it's 'error' — stale death, not user Esc)
    expect(session.notebook.cells[0].status).toBe('error');
    // New cell should be running
    expect(sendPromptSpy).toHaveBeenCalledWith('继续');

    isAliveSpy.mockRestore();
  });

  // ── completeCell interrupted status ─────────────────────────────────────

  it('completeCell sets interrupted status when _interrupted flag is set', async () => {
    let onMessage: (msg: unknown) => void = () => {};
    startSpy.mockImplementation(async (onMsg: (msg: unknown) => void) => {
      onMessage = onMsg;
      onMsg({ type: 'system', subtype: 'hook_started' });
    });

    const session = await createSessionWithRunningCell();

    // Set the _interrupted flag (simulating interruptCell)
    (session as any)._interrupted = true;

    // Simulate Claude returning a result after SIGINT
    onMessage({ type: 'result', result: 'interrupted', is_error: true });
    await new Promise((r) => setTimeout(r, 50));

    // Cell should be 'interrupted', not 'error'
    expect(session.notebook.cells[0].status).toBe('interrupted');
    // Flag should be cleared after use
    expect((session as any)._interrupted).toBeUndefined();
  });

  it('execution_complete broadcast includes status field', async () => {
    let onMessage: (msg: unknown) => void = () => {};
    startSpy.mockImplementation(async (onMsg: (msg: unknown) => void) => {
      onMessage = onMsg;
      onMsg({ type: 'system', subtype: 'hook_started' });
    });

    const session = await createSessionWithRunningCell();
    const messages: any[] = [];
    session.listeners.add((msg: any) => messages.push(msg));

    // Case 1: Normal completion — status should be 'completed'
    onMessage({ type: 'result', result: 'done', is_error: false });
    await new Promise((r) => setTimeout(r, 50));
    const completeMsg = messages.find((m) => m.type === 'execution_complete');
    expect(completeMsg).toBeDefined();
    expect(completeMsg.status).toBe('completed');
  });

  it('execution_complete broadcast includes interrupted status', async () => {
    let onMessage: (msg: unknown) => void = () => {};
    startSpy.mockImplementation(async (onMsg: (msg: unknown) => void) => {
      onMessage = onMsg;
      onMsg({ type: 'system', subtype: 'hook_started' });
    });

    const session = await createSessionWithRunningCell();
    const messages: any[] = [];
    session.listeners.add((msg: any) => messages.push(msg));

    // Set interrupted flag
    (session as any)._interrupted = true;

    // Simulate interrupted completion
    onMessage({ type: 'result', result: 'interrupted', is_error: true });
    await new Promise((r) => setTimeout(r, 50));
    const interruptMsg = messages.find((m) => m.type === 'execution_complete');
    expect(interruptMsg).toBeDefined();
    expect(interruptMsg.status).toBe('interrupted');
  });

  // ── End-to-end: interrupt during rerun ──────────────────────────────────

  it('interrupt during rerun stops auto-execution of subsequent cells', async () => {
    let onMessage: (msg: unknown) => void = () => {};
    startSpy.mockImplementation(async (onMsg: (msg: unknown) => void) => {
      onMessage = onMsg;
      onMsg({ type: 'system', subtype: 'hook_started' });
    });

    const session = await createSessionWithRunningCell();
    const isAliveSpy = vi.spyOn(session.agentProcess, 'isAlive').mockReturnValue(true);

    // Set up a rerun queue (simulating mid-rerun)
    (session as any)._rerunQueue = ['c2'];

    // Interrupt
    await sm.interruptCell(session.id);
    isAliveSpy.mockRestore();

    // Simulate Claude returning a result after SIGINT
    onMessage({ type: 'result', result: 'interrupted', is_error: true });
    await new Promise((r) => setTimeout(r, 50));

    // Cell c1 should be completed with 'interrupted' (not 'error')
    expect(session.notebook.cells[0].status).toBe('interrupted');
    // Cell c2 should NOT have started (rerun queue was cleared)
    expect(session.notebook.cells[1].status).toBe('pending');
    expect(sendPromptSpy).not.toHaveBeenCalledWith('world');
  });
});
