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
