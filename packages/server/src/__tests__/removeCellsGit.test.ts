/**
 * remove_cells git commit — TDD Red tests.
 *
 * Tests:
 * 1. remove_cells triggers gitManager.commitCellExecution after save
 * 2. git commit failure does not prevent cells_removed response
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { SessionManager } from '../session.js';
import { NotebookStore } from '../notebook-store.js';
import { setupWebSocket } from '../ws-handler.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/* ── Minimal mock WS / WSS ───────────────────────────────────────────── */

function makeMockWs() {
  const sent: object[] = [];
  const ee = new EventEmitter();
  return {
    OPEN: 1,
    readyState: 1,
    send(data: string) { sent.push(JSON.parse(data)); },
    close() {},
    on: ee.on.bind(ee),
    removeListener: ee.removeListener.bind(ee),
    // helpers
    _sent: sent,
    _emit: ee.emit.bind(ee),
  };
}

function makeMockWss() {
  const ee = new EventEmitter();
  return {
    on: ee.on.bind(ee),
    _emit: ee.emit.bind(ee),
  };
}

/* ── Tests ────────────────────────────────────────────────────────────── */

describe('remove_cells git commit', () => {
  let sm: SessionManager;
  let ns: NotebookStore;
  let tempDir: string;
  let startSpy: ReturnType<typeof vi.spyOn>;
  let stopSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    sm = new SessionManager();
    ns = new NotebookStore();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-cells-git-'));

    const { AgentProcess } = await import('../agent-process.js');
    startSpy = vi.spyOn(AgentProcess.prototype, 'start').mockImplementation(async (onMsg) => {
      onMsg({ type: 'system', subtype: 'hook_started' });
    });
    stopSpy = vi.spyOn(AgentProcess.prototype, 'stop').mockImplementation(async () => {});
  });

  afterEach(() => {
    startSpy.mockRestore();
    stopSpy.mockRestore();
  });

  async function setupSessionWithCells() {
    const nbPath = path.join(tempDir, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Test', tempDir));
    const session = await sm.createSession(nbPath, tempDir);

    session.notebook = {
      ...session.notebook,
      cells: [
        { id: 'c1', type: 'prompt' as const, source: 'Hello', outputs: [], execution_count: 1, status: 'completed' as const },
        { id: 'c2', type: 'prompt' as const, source: 'World', outputs: [], execution_count: 2, status: 'completed' as const },
      ],
    };
    await ns.save(nbPath, session.notebook);
    return session;
  }

  it('triggers gitManager.commitCellExecution after removing cells', async () => {
    const session = await setupSessionWithCells();

    const commitSpy = vi.spyOn(session.gitManager, 'commitCellExecution')
      .mockResolvedValue({ diff: 'mock', filesChanged: ['test.notebook.json'] });

    // Mock db
    const db = {
      cleanupOldFileAnnotations: vi.fn(),
      updateNotebook: vi.fn(),
      updateNotebookLastOpened: vi.fn(),
    } as any;

    // Wire up ws-handler
    const wss = makeMockWss();
    setupWebSocket(wss as any, db, sm, ns);

    // Simulate WS connection
    const ws = makeMockWs();
    wss._emit('connection', ws, { url: '/' });

    // Must subscribe first (for permission check)
    ws._emit('message', JSON.stringify({
      type: 'subscribe',
      session_id: session.id,
    }));
    await new Promise(r => setTimeout(r, 20));

    // Now send remove_cells
    ws._emit('message', JSON.stringify({
      type: 'remove_cells',
      session_id: session.id,
      cell_ids: ['c1'],
    }));

    // Wait for async handler to complete
    await vi.waitFor(() => {
      const removed = ws._sent.find((m: any) => m.type === 'cells_removed');
      expect(removed).toBeTruthy();
    });

    expect(commitSpy).toHaveBeenCalledWith('edit', expect.stringContaining('1 cell'));
    commitSpy.mockRestore();
  });

  it('sends cells_removed even if git commit fails', async () => {
    const session = await setupSessionWithCells();

    const commitSpy = vi.spyOn(session.gitManager, 'commitCellExecution')
      .mockRejectedValue(new Error('git failed'));

    const db = {
      cleanupOldFileAnnotations: vi.fn(),
      updateNotebook: vi.fn(),
      updateNotebookLastOpened: vi.fn(),
    } as any;

    const wss = makeMockWss();
    setupWebSocket(wss as any, db, sm, ns);

    const ws = makeMockWs();
    wss._emit('connection', ws, { url: '/' });

    // Must subscribe first (for permission check)
    ws._emit('message', JSON.stringify({
      type: 'subscribe',
      session_id: session.id,
    }));
    await new Promise(r => setTimeout(r, 20));

    // Now send remove_cells
    ws._emit('message', JSON.stringify({
      type: 'remove_cells',
      session_id: session.id,
      cell_ids: ['c1'],
    }));

    // Wait for async handler to settle (cells_removed should still arrive)
    await vi.waitFor(() => {
      const removed = ws._sent.find((m: any) => m.type === 'cells_removed');
      expect(removed).toBeTruthy();
    });

    // Despite git failure, no cells_remove_failed should be sent
    const failed = ws._sent.find((m: any) => m.type === 'cells_remove_failed');
    expect(failed).toBeUndefined();

    commitSpy.mockRestore();
  });
});
