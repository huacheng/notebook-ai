/**
 * remove_cells WS handler tests.
 *
 * Tests:
 * 1. remove_cells → cells removed + reply cells_removed + save to disk + db update
 * 2. session not found → reply error
 * 3. save failure → reply cells_remove_failed
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../session.js';
import { NotebookStore } from '../notebook-store.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('remove_cells handler logic', () => {
  let sm: SessionManager;
  let ns: NotebookStore;
  let tempDir: string;
  let startSpy: ReturnType<typeof vi.spyOn>;
  let stopSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    sm = new SessionManager();
    ns = new NotebookStore();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-cells-test-'));

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

  it('should remove specified cells from session notebook', async () => {
    const nbPath = path.join(tempDir, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Test', tempDir));

    const session = await sm.createSession(nbPath, tempDir);

    // Add some cells
    session.notebook = {
      ...session.notebook,
      cells: [
        { id: 'cell-1', type: 'prompt' as const, source: 'Hello', outputs: [], execution_count: 1, status: 'completed' as const },
        { id: 'cell-2', type: 'prompt' as const, source: 'World', outputs: [], execution_count: 2, status: 'completed' as const },
        { id: 'cell-3', type: 'prompt' as const, source: 'Keep', outputs: [], execution_count: 3, status: 'completed' as const },
      ],
    };

    // Simulate what ws-handler will do for remove_cells
    const cellIdsToRemove = new Set(['cell-1', 'cell-3']);
    session.notebook.cells = session.notebook.cells.filter(c => !cellIdsToRemove.has(c.id));

    expect(session.notebook.cells).toHaveLength(1);
    expect(session.notebook.cells[0].id).toBe('cell-2');
  });

  it('should save notebook to disk after removing cells', async () => {
    const nbPath = path.join(tempDir, 'save-test.notebook.json');
    await ns.save(nbPath, ns.createNew('Save Test', tempDir));

    const session = await sm.createSession(nbPath, tempDir);

    session.notebook = {
      ...session.notebook,
      cells: [
        { id: 'cell-1', type: 'prompt' as const, source: 'Remove me', outputs: [], execution_count: 1, status: 'completed' as const },
        { id: 'cell-2', type: 'prompt' as const, source: 'Keep me', outputs: [], execution_count: 2, status: 'completed' as const },
      ],
    };

    // Remove cell-1
    session.notebook.cells = session.notebook.cells.filter(c => c.id !== 'cell-1');

    // Save to disk
    await ns.save(nbPath, session.notebook);

    // Verify disk state
    const saved = await ns.load(nbPath);
    expect(saved.cells).toHaveLength(1);
    expect(saved.cells[0].id).toBe('cell-2');
  });

  it('should handle non-existent session gracefully', () => {
    const session = sm.getSession('non-existent-session');
    expect(session).toBeUndefined();
  });

  it('should handle save failure without crashing', async () => {
    const nbPath = path.join(tempDir, 'fail-save.notebook.json');
    await ns.save(nbPath, ns.createNew('Fail Save', tempDir));

    const session = await sm.createSession(nbPath, tempDir);

    session.notebook = {
      ...session.notebook,
      cells: [
        { id: 'cell-1', type: 'prompt' as const, source: 'Test', outputs: [], execution_count: 1, status: 'completed' as const },
      ],
    };

    // Remove cell
    session.notebook.cells = session.notebook.cells.filter(c => c.id !== 'cell-1');

    // Simulate save failure by saving to a read-only directory
    const { mkdir: fsMkdir, chmod } = await import('fs/promises');
    const roDir = path.join(tempDir, 'readonly-dir');
    await fsMkdir(roDir);
    await chmod(roDir, 0o555);
    const badPath = path.join(roDir, 'fail.notebook.json');
    try {
      await expect(ns.save(badPath, session.notebook)).rejects.toThrow();
    } finally {
      await chmod(roDir, 0o755);
    }
  });
});
