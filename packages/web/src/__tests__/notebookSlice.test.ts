/**
 * notebookSlice tests — updateAgent regression.
 */

import { describe, it, expect } from 'vitest';
import { createNotebookSlice } from '../store/notebookSlice';

function createTestSlice() {
  let state: Record<string, any> = {};

  const set = (update: any) => {
    if (typeof update === 'function') {
      Object.assign(state, update(state));
    } else {
      Object.assign(state, update);
    }
  };

  const get = () => state as any;

  const slice = createNotebookSlice(set as any, get, {} as any);
  Object.assign(state, slice);

  return { state, getAction: (name: string) => (state as any)[name].bind(state) };
}

describe('updateAgent', () => {
  it('is a function on the slice', () => {
    const { state } = createTestSlice();
    expect(typeof state.updateAgent).toBe('function');
  });

  it('updates notebook metadata.agent to gemini', () => {
    const { state, getAction } = createTestSlice();
    state.notebook = {
      version: 1,
      metadata: { title: 'Test', created: '2025-01-01', agent: 'claude', git_repo: false },
      cells: [],
      slice: { generated: false, sections: [] },
      annotations: [],
      assets: { intermediate_files: [] },
    };
    getAction('updateAgent')('gemini');
    expect(state.notebook.metadata.agent).toBe('gemini');
  });

  it('updates metadata.updated timestamp', () => {
    const { state, getAction } = createTestSlice();
    state.notebook = {
      version: 1,
      metadata: { title: 'Test', created: '2025-01-01', updated: '2025-01-01', agent: 'claude', git_repo: false },
      cells: [],
      slice: { generated: false, sections: [] },
      annotations: [],
      assets: { intermediate_files: [] },
    };
    getAction('updateAgent')('gemini');
    expect(state.notebook.metadata.updated).not.toBe('2025-01-01');
  });

  it('no-ops when notebook is null', () => {
    const { state, getAction } = createTestSlice();
    expect(state.notebook).toBeNull();
    getAction('updateAgent')('gemini');
    expect(state.notebook).toBeNull();
  });
});

// ── prependCells + cellsOffset tests ──────────────────────────────────────

function makeNotebook(cellIds: string[]) {
  return {
    version: 1,
    metadata: { title: 'Test', created: '2025-01-01', agent: 'claude' as const, git_repo: false },
    cells: cellIds.map((id, i) => ({
      id,
      type: 'prompt' as const,
      source: `cell-${id}`,
      outputs: [],
      execution_count: i + 1,
      status: 'completed' as const,
    })),
    slice: { generated: false, sections: [] },
    annotations: [],
    assets: { intermediate_files: [] },
  };
}

describe('prependCells', () => {
  it('inserts old cells at the front and updates cellsOffset', () => {
    const { state, getAction } = createTestSlice();
    state.notebook = makeNotebook(['c3', 'c4', 'c5']);
    state.cellsOffset = 3;

    const olderCells = [
      { id: 'c1', type: 'prompt' as const, source: 'old-1', outputs: [], execution_count: 1, status: 'completed' as const },
      { id: 'c2', type: 'prompt' as const, source: 'old-2', outputs: [], execution_count: 2, status: 'completed' as const },
    ];

    getAction('prependCells')(olderCells, 1);

    expect(state.notebook.cells).toHaveLength(5);
    expect(state.notebook.cells[0].id).toBe('c1');
    expect(state.notebook.cells[1].id).toBe('c2');
    expect(state.notebook.cells[2].id).toBe('c3');
    expect(state.cellsOffset).toBe(1);
  });

  it('does not affect tail cells', () => {
    const { state, getAction } = createTestSlice();
    state.notebook = makeNotebook(['c10', 'c11']);
    state.cellsOffset = 10;

    const olderCells = [
      { id: 'c9', type: 'prompt' as const, source: 'old', outputs: [], execution_count: 9, status: 'completed' as const },
    ];

    getAction('prependCells')(olderCells, 9);

    expect(state.notebook.cells[state.notebook.cells.length - 1].id).toBe('c11');
    expect(state.notebook.cells[state.notebook.cells.length - 2].id).toBe('c10');
  });

  it('no-ops when notebook is null', () => {
    const { state, getAction } = createTestSlice();
    expect(state.notebook).toBeNull();
    getAction('prependCells')([], 0);
    expect(state.notebook).toBeNull();
  });
});

describe('cellsOffset initial state', () => {
  it('defaults to 0', () => {
    const { state } = createTestSlice();
    expect(state.cellsOffset).toBe(0);
  });

  it('loadingOlderCells defaults to false', () => {
    const { state } = createTestSlice();
    expect(state.loadingOlderCells).toBe(false);
  });
});

describe('cells_loaded WS message — wsSlice handler dispatch', () => {
  /**
   * This test exercises the ACTUAL wsSlice onmessage handler by:
   * 1. Creating a full store with all slices (including wsSlice)
   * 2. Connecting a mock WebSocket
   * 3. Dispatching a cells_loaded message through ws.onmessage
   * 4. Asserting that prependCells was called and loadingOlderCells was set to false
   *
   * If the 'cells_loaded' case is removed from wsSlice.ts, this test will FAIL
   * because prependCells won't be called and loadingOlderCells will stay true.
   */
  it('wsSlice handler calls prependCells and clears loadingOlderCells on cells_loaded', async () => {
    // Build a combined store using all slices (like the real store.ts)
    const { createNotebookSlice } = await import('../store/notebookSlice');
    const { createWsSlice } = await import('../store/wsSlice');

    let state: Record<string, any> = {};
    const set = (update: any) => {
      if (typeof update === 'function') {
        Object.assign(state, update(state));
      } else {
        Object.assign(state, update);
      }
    };
    const get = () => state as any;

    // Merge both slices into a single state
    Object.assign(state, createNotebookSlice(set as any, get, {} as any));
    Object.assign(state, createWsSlice(set as any, get, {} as any));

    // Set up notebook + offset + loadingOlderCells
    state.notebook = makeNotebook(['c10', 'c11', 'c12']);
    state.cellsOffset = 10;
    state.loadingOlderCells = true;

    // Create a mock WebSocket that captures the onmessage handler
    let capturedOnMessage: ((event: any) => void) | null = null;
    const mockWs = {
      readyState: 1, // WebSocket.OPEN
      OPEN: 1,
      send: () => {},
      close: () => {},
      set onopen(fn: any) { /* ignore */ },
      set onclose(fn: any) { /* ignore */ },
      set onerror(fn: any) { /* ignore */ },
      set onmessage(fn: any) { capturedOnMessage = fn; },
    };

    // Monkey-patch global WebSocket to return our mock
    const OriginalWebSocket = globalThis.WebSocket;
    (globalThis as any).WebSocket = function () { return mockWs; } as any;
    (globalThis as any).WebSocket.OPEN = 1;

    // Also need window.location for connectWebSocket
    if (typeof globalThis.window === 'undefined') {
      (globalThis as any).window = { location: { protocol: 'ws:', host: 'localhost:3000' } };
    }
    const origPerf = globalThis.performance;
    if (!globalThis.performance) {
      (globalThis as any).performance = { now: () => Date.now() };
    }

    try {
      // Call connectWebSocket — this registers onmessage on our mock
      state.connectWebSocket();

      expect(capturedOnMessage).not.toBeNull();

      // Dispatch a cells_loaded message through the actual handler
      const olderCells = [
        { id: 'c7', type: 'prompt', source: 'old-7', outputs: [], execution_count: 7, status: 'completed' },
        { id: 'c8', type: 'prompt', source: 'old-8', outputs: [], execution_count: 8, status: 'completed' },
        { id: 'c9', type: 'prompt', source: 'old-9', outputs: [], execution_count: 9, status: 'completed' },
      ];
      const message = JSON.stringify({
        type: 'cells_loaded',
        session_id: 'test-session',
        cells: olderCells,
        offset: 7,
      });

      capturedOnMessage!({ data: message });

      // Assert: prependCells was called (cells prepended + offset updated)
      expect(state.notebook.cells).toHaveLength(6);
      expect(state.notebook.cells[0].id).toBe('c7');
      expect(state.notebook.cells[1].id).toBe('c8');
      expect(state.notebook.cells[2].id).toBe('c9');
      expect(state.notebook.cells[3].id).toBe('c10');
      expect(state.cellsOffset).toBe(7);

      // Assert: loadingOlderCells was set to false by the handler
      expect(state.loadingOlderCells).toBe(false);
    } finally {
      (globalThis as any).WebSocket = OriginalWebSocket;
      (globalThis as any).performance = origPerf;
    }
  });
});
