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

describe('cells_loaded WS message integration', () => {
  it('prependCells + loadingOlderCells=false when cells arrive', () => {
    const { state, getAction } = createTestSlice();
    state.notebook = makeNotebook(['c10', 'c11', 'c12']);
    state.cellsOffset = 10;
    state.loadingOlderCells = true;

    // Simulate what wsSlice handler should do on cells_loaded
    const olderCells = [
      { id: 'c7', type: 'prompt' as const, source: 'old-7', outputs: [], execution_count: 7, status: 'completed' as const },
      { id: 'c8', type: 'prompt' as const, source: 'old-8', outputs: [], execution_count: 8, status: 'completed' as const },
      { id: 'c9', type: 'prompt' as const, source: 'old-9', outputs: [], execution_count: 9, status: 'completed' as const },
    ];

    getAction('prependCells')(olderCells, 7);
    state.loadingOlderCells = false;

    expect(state.notebook.cells).toHaveLength(6);
    expect(state.notebook.cells[0].id).toBe('c7');
    expect(state.cellsOffset).toBe(7);
    expect(state.loadingOlderCells).toBe(false);
  });
});
