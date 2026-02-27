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
    interruptSpy = vi.spyOn(AgentProcess.prototype, 'interrupt');
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

  // ── SessionManager.interruptCell() ──────────────────────────────────────

  it('interruptCell() calls agent interrupt()', async () => {
    const session = await createSessionWithRunningCell();

    await sm.interruptCell(session.id);

    expect(interruptSpy).toHaveBeenCalledTimes(1);
  });

  it('interruptCell() clears _rerunQueue', async () => {
    const session = await createSessionWithRunningCell();
    // Simulate an active rerun queue
    (session as any)._rerunQueue = ['c2'];

    await sm.interruptCell(session.id);

    expect((session as any)._rerunQueue).toBeUndefined();
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

    // Complete the running cell first so we can execute a new one
    onMessage({ type: 'result', result: 'interrupted', is_error: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(session.notebook.cells[0].status).toBe('error');

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

    // Stale running cell should have been force-completed as error
    expect(session.notebook.cells[0].status).toBe('error');
    // New cell should be running
    expect(sendPromptSpy).toHaveBeenCalledWith('继续');

    isAliveSpy.mockRestore();
  });

  // ── End-to-end: interrupt during rerun ──────────────────────────────────

  it('interrupt during rerun stops auto-execution of subsequent cells', async () => {
    let onMessage: (msg: unknown) => void = () => {};
    startSpy.mockImplementation(async (onMsg: (msg: unknown) => void) => {
      onMessage = onMsg;
      onMsg({ type: 'system', subtype: 'hook_started' });
    });

    const session = await createSessionWithRunningCell();

    // Set up a rerun queue (simulating mid-rerun)
    (session as any)._rerunQueue = ['c2'];

    // Interrupt
    await sm.interruptCell(session.id);

    // Simulate Claude returning a result after SIGINT
    onMessage({ type: 'result', result: 'interrupted', is_error: true });
    await new Promise((r) => setTimeout(r, 50));

    // Cell c1 should be completed with error
    expect(session.notebook.cells[0].status).toBe('error');
    // Cell c2 should NOT have started (rerun queue was cleared)
    expect(session.notebook.cells[1].status).toBe('pending');
    expect(sendPromptSpy).not.toHaveBeenCalledWith('world');
  });
});
