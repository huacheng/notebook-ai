/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { createNotebookSlice } from '../store/notebookSlice';

// ── Minimal slice test harness ────────────────────────────────────────────

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

  return { state, set, get };
}

const dummyNotebook = {
  cells: [],
  metadata: { title: 'test', created: '', git_repo: false, agent: 'claude' as const },
  version: 1,
  slice: { generated: false, sections: [] },
  annotations: [],
  assets: { intermediate_files: [] },
} as any;

describe('setActiveNotebookTab does not save window.scrollY', () => {
  it('does not overwrite scrollY with window.scrollY when switching tabs', () => {
    const { state } = createTestSlice();
    // Populate two open notebooks
    state.openNotebooks = {
      nb1: { notebook: dummyNotebook, sessionId: 's1', scrollY: 42, workspaceDir: null },
      nb2: { notebook: dummyNotebook, sessionId: 's2', scrollY: 0, workspaceDir: null },
    };
    state.activeNotebookTabId = 'nb1';

    // Mock window.scrollY to a non-zero value to expose the bug
    Object.defineProperty(window, 'scrollY', { value: 999, configurable: true });

    state.setActiveNotebookTab('nb2');

    // After switching, the old tab's scrollY should remain unchanged (42),
    // NOT be overwritten to window.scrollY (999).
    // useScrollRestoration handles scroll persistence via localStorage.
    expect(state.openNotebooks.nb1.scrollY).toBe(42);

    // Restore
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });
});
