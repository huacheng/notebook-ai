/**
 * Notebook rerun (Pipeline mode) tests (Step 7).
 *
 * Tests:
 * 1. rerunNotebook clears all cells' outputs
 * 2. rerunNotebook resets all cells' status to pending
 * 3. rerunNotebook rebuilds agentProcess (new instance, old stopped)
 * 4. rerunNotebook does NOT pass resumeSessionId (clean context)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../session.js';
import { NotebookStore } from '../notebook-store.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('rerunNotebook (Pipeline mode)', () => {
  let sm: SessionManager;
  let ns: NotebookStore;
  let tempDir: string;
  let startSpy: ReturnType<typeof vi.spyOn>;
  let stopSpy: ReturnType<typeof vi.spyOn>;
  let sendPromptSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    sm = new SessionManager();
    ns = new NotebookStore();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rerun-test-'));

    const { AgentProcess } = await import('../agent-process.js');
    startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg) => {
      onMsg({ type: 'system', subtype: 'hook_started' });
    });
    stopSpy = vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(() => {});
    sendPromptSpy = vi.spyOn(AgentProcess.prototype, 'sendPrompt').mockImplementation(() => {});
  });

  afterEach(() => {
    startSpy.mockRestore();
    stopSpy.mockRestore();
    sendPromptSpy.mockRestore();
  });

  async function createSessionWithCells() {
    const nbPath = path.join(tempDir, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Test', tempDir));

    const session = await sm.createSession(nbPath, tempDir);

    // Add cells with outputs
    session.notebook = {
      ...session.notebook,
      cells: [
        {
          id: 'c1', type: 'prompt' as const, source: 'prompt 1',
          outputs: [{ type: 'text', content: 'response 1', timestamp: '2025-01-01' }],
          execution_count: 1, status: 'completed' as const,
        },
        {
          id: 'c2', type: 'prompt' as const, source: 'prompt 2',
          outputs: [{ type: 'text', content: 'response 2', timestamp: '2025-01-01' }],
          execution_count: 2, status: 'completed' as const,
        },
        {
          id: 'c3', type: 'prompt' as const, source: 'prompt 3',
          outputs: [
            { type: 'thinking', content: 'thinking...', timestamp: '2025-01-01' },
            { type: 'text', content: 'response 3', timestamp: '2025-01-01' },
          ],
          execution_count: 3, status: 'error' as const,
        },
      ],
    };

    return session;
  }

  it('clears all cells outputs', async () => {
    const session = await createSessionWithCells();
    expect(session.notebook.cells.every(c => c.type === 'prompt' && c.outputs.length > 0)).toBe(true);

    await sm.rerunNotebook(session.id);

    for (const cell of session.notebook.cells) {
      if (cell.type === 'prompt') expect(cell.outputs).toEqual([]);
    }
  });

  it('resets cells and starts first cell running', async () => {
    const session = await createSessionWithCells();

    await sm.rerunNotebook(session.id);

    // First cell should be running (rerun auto-executes it)
    expect(session.notebook.cells[0].status).toBe('running');
    // Remaining cells should still be pending
    for (const cell of session.notebook.cells.slice(1)) {
      expect(cell.status).toBe('pending');
    }
  });

  it('rebuilds agentProcess (old stopped, new started)', async () => {
    const session = await createSessionWithCells();
    const originalAgent = session.agentProcess;

    await sm.rerunNotebook(session.id);

    // stop should have been called on the old process
    expect(stopSpy).toHaveBeenCalledTimes(1);
    // start should be called twice: once for initial, once for rerun
    expect(startSpy).toHaveBeenCalledTimes(2);
    // agent process should be a new instance
    expect(session.agentProcess).not.toBe(originalAgent);
  });

  it('does NOT pass resumeSessionId (clean context)', async () => {
    // Set up with a claudeSessionId
    let startCallCount = 0;
    startSpy.mockImplementation(async (onMsg: (msg: unknown) => void) => {
      startCallCount++;
      onMsg({ type: 'system', subtype: 'hook_started' });
      if (startCallCount === 1) {
        onMsg({ type: 'system', subtype: 'init', session_id: 'claude-xyz' });
      }
    });

    const session = await createSessionWithCells();
    expect(session.claudeSessionId).toBe('claude-xyz');

    await sm.rerunNotebook(session.id);

    // The rerun start call should NOT have resumeSessionId
    const rerunCall = startSpy.mock.calls[startSpy.mock.calls.length - 1];
    // 3rd arg is resumeSessionId — should be undefined for rerun
    expect(rerunCall[2]).toBeUndefined();
  });

  it('throws for non-existent session', async () => {
    await expect(sm.rerunNotebook('non-existent')).rejects.toThrow(
      'Session "non-existent" not found',
    );
  });

  // ── Rerun execution tests ──────────────────────────────────────────────────

  it('executes first prompt cell after rerun', async () => {
    const session = await createSessionWithCells();
    await sm.rerunNotebook(session.id);

    // First cell should be running, sendPrompt called with its source
    expect(session.notebook.cells[0].status).toBe('running');
    expect(sendPromptSpy).toHaveBeenCalledWith('prompt 1');
  });

  it('auto-executes next pending cell after first completes', async () => {
    // Capture the onMessage handler so we can simulate result messages
    let onMessage: (msg: unknown) => void = () => {};
    startSpy.mockImplementation(async (onMsg: (msg: unknown) => void) => {
      onMessage = onMsg;
      onMsg({ type: 'system', subtype: 'hook_started' });
    });

    const session = await createSessionWithCells();
    await sm.rerunNotebook(session.id);

    // First cell is running
    expect(session.notebook.cells[0].status).toBe('running');
    expect(sendPromptSpy).toHaveBeenCalledWith('prompt 1');

    // Simulate first cell completion
    onMessage({ type: 'result', result: 'done 1', is_error: false });

    // Allow deferred execution (setTimeout in completeCell + rerun chain)
    await new Promise((r) => setTimeout(r, 50));

    // First cell should be completed, second cell should now be running
    expect(session.notebook.cells[0].status).toBe('completed');
    expect(session.notebook.cells[1].status).toBe('running');
    expect(sendPromptSpy).toHaveBeenCalledWith('prompt 2');
  });

  it('cleans up _rerunQueue after all cells finish', async () => {
    let onMessage: (msg: unknown) => void = () => {};
    startSpy.mockImplementation(async (onMsg: (msg: unknown) => void) => {
      onMessage = onMsg;
      onMsg({ type: 'system', subtype: 'hook_started' });
    });

    const session = await createSessionWithCells();
    await sm.rerunNotebook(session.id);

    // Execute all 3 cells in sequence
    for (let i = 0; i < 3; i++) {
      onMessage({ type: 'result', result: `done ${i}`, is_error: false });
      await new Promise((r) => setTimeout(r, 50));
    }

    // All cells should be completed
    expect(session.notebook.cells.every((c) => c.status === 'completed')).toBe(true);
    // _rerunQueue should be cleaned up
    expect((session as any)._rerunQueue).toBeUndefined();
  });
});
