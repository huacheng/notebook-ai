/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';

const dummyNotebook = (title: string) => ({
  version: 1,
  metadata: { title, created: '', agent: 'claude' as const, git_repo: false },
  cells: [],
  slide: { generated: false, sections: [] },
  annotations: [],
  assets: { intermediate_files: [] },
} as any);

// ── mergeServerCells fallback when localLastId deleted ──────────────────────

describe('session_state merge: localLastId not found in server', () => {
  beforeEach(() => {
    useStore.setState({
      notebook: null,
      openNotebooks: {},
      activeNotebookTabId: null,
      sessionId: null as any,
    });
  });

  const makeCell = (id: string) => ({
    id,
    type: 'prompt' as const,
    source: `src-${id}`,
    outputs: [],
    execution_count: 0,
    status: 'idle' as const,
  });

  it('appends server-only cells when localLastId was deleted on server', () => {
    // Local has cell-A (now deleted on server) + cell-B
    // Server has cell-B + cell-C + cell-D (new)
    // Expected: cell-B, cell-C, cell-D (cell-A dropped, cell-C/D appended)
    const localNb = {
      ...dummyNotebook('test'),
      cells: [makeCell('cell-A'), makeCell('cell-B')],
    };
    const serverCells = [makeCell('cell-B'), makeCell('cell-C'), makeCell('cell-D')];

    useStore.setState({
      notebook: localNb,
      sessionId: 'session-1',
      openNotebooks: {
        'nb1': { notebook: localNb, sessionId: 'session-1', scrollY: 0, workspaceDir: null },
      },
      activeNotebookTabId: 'nb1',
    });

    const serverNb = { ...dummyNotebook('test'), cells: serverCells };
    useStore.getState().processServerState('session-1', serverNb);

    const state = useStore.getState();
    const resultCells = state.notebook!.cells.map((c: any) => c.id);
    expect(resultCells).toContain('cell-B');
    expect(resultCells).toContain('cell-C');
    expect(resultCells).toContain('cell-D');
    expect(resultCells).not.toContain('cell-A');
  });

  it('handles normal case: local cell not deleted, new cells appended', () => {
    const localNb = {
      ...dummyNotebook('test'),
      cells: [makeCell('cell-A'), makeCell('cell-B')],
    };
    const serverCells = [makeCell('cell-A'), makeCell('cell-B'), makeCell('cell-C')];
    useStore.setState({
      notebook: localNb,
      sessionId: 'session-2',
      openNotebooks: {
        'nb2': { notebook: localNb, sessionId: 'session-2', scrollY: 0, workspaceDir: null },
      },
      activeNotebookTabId: 'nb2',
    });
    const serverNb = { ...dummyNotebook('test'), cells: serverCells };
    useStore.getState().processServerState('session-2', serverNb);

    const resultCells = useStore.getState().notebook!.cells.map((c: any) => c.id);
    expect(resultCells).toEqual(['cell-A', 'cell-B', 'cell-C']);
  });
});

describe('state.notebook ↔ openNotebooks bidirectional sync', () => {
  beforeEach(() => {
    // Reset store state
    useStore.setState({
      notebook: null,
      openNotebooks: {},
      activeNotebookTabId: null,
    });
  });

  it('user mutation on state.notebook syncs to openNotebooks', () => {
    const nb = dummyNotebook('test');
    // Simulate opening a notebook tab
    useStore.setState({
      notebook: nb,
      activeNotebookTabId: 'nb1',
      openNotebooks: {
        nb1: { notebook: nb, sessionId: 's1', scrollY: 0, workspaceDir: null },
      },
    });

    // Simulate a user mutation (e.g., addCell modifies state.notebook)
    const mutatedNb = { ...nb, cells: [{ id: 'c1', type: 'prompt', source: '', outputs: [], execution_count: 0, status: 'idle' }] };
    useStore.setState({ notebook: mutatedNb });

    // The subscriber should have synced the change to openNotebooks
    const state = useStore.getState();
    expect(state.openNotebooks.nb1.notebook.cells).toHaveLength(1);
    expect(state.openNotebooks.nb1.notebook.cells[0].id).toBe('c1');
  });
});
