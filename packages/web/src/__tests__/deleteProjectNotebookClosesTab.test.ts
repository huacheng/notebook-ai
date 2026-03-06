/**
 * closeNotebookTabByPath should close the notebook tab matching a workspaceDir path.
 * This is used when deleting a notebook from the project file browser.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createNotebookSlice } from '../store/notebookSlice';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();
if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });
}

function makeNotebook(title: string, projectId = 'proj-1') {
  return {
    version: 1,
    metadata: { title, created: '2025-01-01', agent: 'claude' as const, git_repo: false, project_id: projectId },
    cells: [],
    slide: { generated: false, sections: [] },
    annotations: [],
    assets: { intermediate_files: [] },
  };
}

function createTestSlice() {
  let state: Record<string, any> = {};
  const set = (update: any) => {
    if (typeof update === 'function') Object.assign(state, update(state));
    else Object.assign(state, update);
  };
  const get = () => state as any;
  Object.assign(state, createNotebookSlice(set as any, get, {} as any));
  // Stub unsubscribeFromSession
  state.unsubscribeFromSession = vi.fn();
  return state;
}

describe('closeNotebookTabByPath', () => {
  afterEach(() => vi.restoreAllMocks());

  it('closes the notebook tab whose workspaceDir matches the path', () => {
    const state = createTestSlice();
    const nb1 = makeNotebook('NB1');
    const nb2 = makeNotebook('NB2');
    state.openNotebooks = {
      'nb-aaa': { notebook: nb1, sessionId: 's1', scrollY: 0, workspaceDir: '/ws/proj/my-notebook' },
      'nb-bbb': { notebook: nb2, sessionId: 's2', scrollY: 0, workspaceDir: '/ws/proj/other' },
    };
    state.activeNotebookTabId = 'nb-aaa';

    state.closeNotebookTabByPath('/ws/proj/my-notebook');

    expect(state.openNotebooks).not.toHaveProperty('nb-aaa');
    expect(state.openNotebooks).toHaveProperty('nb-bbb');
    expect(state.activeNotebookTabId).toBe('nb-bbb');
    expect(state.notebook).toBe(nb2);
  });

  it('clears all state when the only tab is closed', () => {
    const state = createTestSlice();
    const nb = makeNotebook('Only');
    state.openNotebooks = {
      'nb-aaa': { notebook: nb, sessionId: 's1', scrollY: 0, workspaceDir: '/ws/proj/only' },
    };
    state.activeNotebookTabId = 'nb-aaa';

    state.closeNotebookTabByPath('/ws/proj/only');

    expect(state.openNotebooks).not.toHaveProperty('nb-aaa');
    expect(state.activeNotebookTabId).toBeNull();
    expect(state.notebook).toBeNull();
  });

  it('matches with trailing slash stripped', () => {
    const state = createTestSlice();
    const nb = makeNotebook('NB');
    state.openNotebooks = {
      'nb-aaa': { notebook: nb, sessionId: 's1', scrollY: 0, workspaceDir: '/ws/proj/nb-dir' },
    };
    state.activeNotebookTabId = 'nb-aaa';

    state.closeNotebookTabByPath('/ws/proj/nb-dir/');

    expect(state.openNotebooks).not.toHaveProperty('nb-aaa');
  });

  it('does nothing when no tab matches', () => {
    const state = createTestSlice();
    const nb = makeNotebook('NB');
    state.openNotebooks = {
      'nb-aaa': { notebook: nb, sessionId: 's1', scrollY: 0, workspaceDir: '/ws/proj/existing' },
    };
    state.activeNotebookTabId = 'nb-aaa';

    state.closeNotebookTabByPath('/ws/proj/nonexistent');

    expect(state.openNotebooks).toHaveProperty('nb-aaa');
    expect(state.activeNotebookTabId).toBe('nb-aaa');
  });
});
