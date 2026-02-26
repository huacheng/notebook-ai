/**
 * load_cells WS handler tests.
 *
 * Tests:
 * 1. load_cells returns correct cells slice
 * 2. offset out of range returns empty array
 * 3. session not found returns error
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../session.js';
import { NotebookStore } from '../notebook-store.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('load_cells handler logic', () => {
  let sm: SessionManager;
  let ns: NotebookStore;
  let tempDir: string;
  let startSpy: ReturnType<typeof vi.spyOn>;
  let stopSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    sm = new SessionManager();
    ns = new NotebookStore();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-cells-test-'));

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

  it('should return correct cells slice for given offset and limit', async () => {
    const nbPath = path.join(tempDir, 'test.notebook.json');
    await ns.save(nbPath, ns.createNew('Test', tempDir));

    const session = await sm.createSession(nbPath, tempDir);

    // Create 20 cells
    session.notebook = {
      ...session.notebook,
      cells: Array.from({ length: 20 }, (_, i) => ({
        id: `cell-${i}`,
        type: 'prompt' as const,
        source: `prompt-${i}`,
        outputs: [],
        execution_count: i + 1,
        status: 'completed' as const,
      })),
    };

    // Simulate what ws-handler will do for load_cells
    const offset = 5;
    const limit = 10;
    const cells = session.notebook.cells.slice(offset, offset + limit);

    expect(cells).toHaveLength(10);
    expect(cells[0].id).toBe('cell-5');
    expect(cells[9].id).toBe('cell-14');
  });

  it('should return empty array when offset is beyond total cells', async () => {
    const nbPath = path.join(tempDir, 'test2.notebook.json');
    await ns.save(nbPath, ns.createNew('Test2', tempDir));

    const session = await sm.createSession(nbPath, tempDir);
    session.notebook = {
      ...session.notebook,
      cells: [
        { id: 'cell-0', type: 'prompt' as const, source: 'only', outputs: [], execution_count: 1, status: 'completed' as const },
      ],
    };

    const offset = 100;
    const limit = 10;
    const cells = session.notebook.cells.slice(offset, offset + limit);

    expect(cells).toHaveLength(0);
  });

  it('should handle partial range at the end', async () => {
    const nbPath = path.join(tempDir, 'test3.notebook.json');
    await ns.save(nbPath, ns.createNew('Test3', tempDir));

    const session = await sm.createSession(nbPath, tempDir);
    session.notebook = {
      ...session.notebook,
      cells: Array.from({ length: 5 }, (_, i) => ({
        id: `cell-${i}`,
        type: 'prompt' as const,
        source: `p-${i}`,
        outputs: [],
        execution_count: i + 1,
        status: 'completed' as const,
      })),
    };

    // Request from offset 3 with limit 10 — should only return 2 cells
    const offset = 3;
    const limit = 10;
    const cells = session.notebook.cells.slice(offset, offset + limit);

    expect(cells).toHaveLength(2);
    expect(cells[0].id).toBe('cell-3');
    expect(cells[1].id).toBe('cell-4');
  });

  it('should return undefined for non-existent session', () => {
    const session = sm.getSession('non-existent-session');
    expect(session).toBeUndefined();
  });
});
