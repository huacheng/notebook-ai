import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../session.js';
import { NotebookStore } from '../notebook-store.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('SessionManager.restartSession()', () => {
  let sm: SessionManager;
  let ns: NotebookStore;
  let tempDir: string;
  let startSpy: ReturnType<typeof vi.spyOn>;
  let stopSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    sm = new SessionManager();
    ns = new NotebookStore();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restart-test-'));

    const { AgentProcess } = await import('../agent-process.js');
    startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg) => {
      onMsg({ type: 'system', subtype: 'hook_started' });
    });
    stopSpy = vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(() => {});
  });

  afterEach(() => {
    startSpy.mockRestore();
    stopSpy.mockRestore();
  });

  it('should return the same session ID after restart', async () => {
    const nbPath = path.join(tempDir, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Test', tempDir));

    const session = await sm.createSession(nbPath, tempDir);
    const originalId = session.id;

    await sm.restartSession(originalId);

    const afterRestart = sm.getSession(originalId);
    expect(afterRestart).toBeDefined();
    expect(afterRestart!.id).toBe(originalId);
  });

  it('should have a live agentProcess after restart', async () => {
    const nbPath = path.join(tempDir, 'alive.notebook.json');
    await ns.save(nbPath, ns.createNew('Alive Test', tempDir));

    const session = await sm.createSession(nbPath, tempDir);

    await sm.restartSession(session.id);

    // start should have been called twice: once for create, once for restart
    expect(startSpy).toHaveBeenCalledTimes(2);
    // stop should have been called once (during restart)
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('should preserve notebook state (cells) after restart', async () => {
    const nbPath = path.join(tempDir, 'cells.notebook.json');
    await ns.save(nbPath, ns.createNew('Cell Test', tempDir));

    const session = await sm.createSession(nbPath, tempDir);

    // Mutate the notebook to add a cell
    session.notebook = {
      ...session.notebook,
      cells: [
        ...session.notebook.cells,
        {
          id: 'cell-1',
          type: 'prompt' as const,
          source: 'Hello',
          outputs: [],
          execution_count: 1,
          status: 'completed' as const,
        },
      ],
    };

    await sm.restartSession(session.id);

    const afterRestart = sm.getSession(session.id);
    expect(afterRestart!.notebook.cells).toHaveLength(1);
    expect(afterRestart!.notebook.cells[0].id).toBe('cell-1');
  });

  it('should preserve listeners after restart', async () => {
    const nbPath = path.join(tempDir, 'listeners.notebook.json');
    await ns.save(nbPath, ns.createNew('Listener Test', tempDir));

    const session = await sm.createSession(nbPath, tempDir);
    const listener = vi.fn();
    sm.addListener(session.id, listener);

    await sm.restartSession(session.id);

    // Broadcast after restart — listener should still receive
    sm.broadcastToSession(session.id, { type: 'pong' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should throw when restarting a non-existent session', async () => {
    await expect(sm.restartSession('non-existent')).rejects.toThrow(
      'Session "non-existent" not found',
    );
  });

  it('should mark running cell as error when process exits unexpectedly (regression)', async () => {
    const nbPath = path.join(tempDir, 'crash.notebook.json');
    await ns.save(nbPath, ns.createNew('Crash Test', tempDir));

    // Capture the onExit callback
    let capturedOnExit: ((code: number | null) => void) | undefined;
    startSpy.mockImplementation(async (onMsg: (msg: unknown) => void, onExit?: (code: number | null) => void) => {
      onMsg({ type: 'system', subtype: 'hook_started' });
      capturedOnExit = onExit;
    });

    const session = await sm.createSession(nbPath, tempDir);

    // Add a running cell
    session.notebook = {
      ...session.notebook,
      cells: [
        {
          id: 'running-cell',
          type: 'prompt' as const,
          source: 'test',
          outputs: [],
          execution_count: 1,
          status: 'running' as const,
        },
      ],
    };

    // Track broadcasts
    const broadcasts: unknown[] = [];
    sm.addListener(session.id, (msg) => broadcasts.push(msg));

    // Simulate process crash
    expect(capturedOnExit).toBeDefined();
    capturedOnExit!(1);

    // Cell should be marked as error
    const cell = session.notebook.cells.find((c) => c.id === 'running-cell');
    expect(cell?.status).toBe('error');

    // execution_complete should have been broadcast
    const complete = broadcasts.find(
      (m: any) => m.type === 'execution_complete' && m.cell_id === 'running-cell',
    );
    expect(complete).toBeDefined();
  });
});
