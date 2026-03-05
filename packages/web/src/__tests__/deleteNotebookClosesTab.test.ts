/**
 * deleteNotebook should close the corresponding tab in openNotebooks.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSidebarSlice } from '../store/sidebarSlice';
import { createNotebookSlice } from '../store/notebookSlice';

// Mock localStorage for Node environment
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

function makeNotebookObj(title = 'Test', projectId?: string) {
  return {
    version: 1,
    metadata: {
      title,
      created: '2025-01-01',
      agent: 'claude' as const,
      git_repo: false,
      ...(projectId ? { project_id: projectId } : {}),
    },
    cells: [],
    slide: { generated: false, sections: [] },
    annotations: [],
    assets: { intermediate_files: [] },
  };
}

function createCombinedSlice() {
  let state: Record<string, any> = {};

  const set = (update: any) => {
    if (typeof update === 'function') {
      Object.assign(state, update(state));
    } else {
      Object.assign(state, update);
    }
  };

  const get = () => state as any;

  // Merge both slices
  Object.assign(state, createNotebookSlice(set as any, get, {} as any));
  Object.assign(state, createSidebarSlice(set as any, get, {} as any));

  return { state, get };
}

describe('deleteNotebook closes openNotebooks tab', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes the deleted notebook from openNotebooks', async () => {
    const { state } = createCombinedSlice();

    // Mock fetch for the DELETE call
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as any);

    // Set up: two open notebook tabs
    const nb1 = makeNotebookObj('NB1');
    const nb2 = makeNotebookObj('NB2');
    state.openNotebooks = {
      'nb-1': { notebook: nb1, sessionId: 's1', scrollY: 0, workspaceDir: null },
      'nb-2': { notebook: nb2, sessionId: 's2', scrollY: 0, workspaceDir: null },
    };
    state.activeNotebookTabId = 'nb-1';
    state.activeNotebookId = 'nb-1';
    state.notebook = nb1;
    state.notebookList = [
      { id: 'nb-1', title: 'NB1', updated_at: '2025-01-01' },
      { id: 'nb-2', title: 'NB2', updated_at: '2025-01-01' },
    ];

    await state.deleteNotebook('nb-1');

    // The deleted notebook should be removed from openNotebooks
    expect(state.openNotebooks).not.toHaveProperty('nb-1');
    // nb-2 should still be there
    expect(state.openNotebooks).toHaveProperty('nb-2');
  });

  it('switches active tab to remaining notebook after deletion', async () => {
    const { state } = createCombinedSlice();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as any);

    const nb1 = makeNotebookObj('NB1');
    const nb2 = makeNotebookObj('NB2');
    state.openNotebooks = {
      'nb-1': { notebook: nb1, sessionId: 's1', scrollY: 0, workspaceDir: null },
      'nb-2': { notebook: nb2, sessionId: 's2', scrollY: 0, workspaceDir: '/tmp/w2' },
    };
    state.activeNotebookTabId = 'nb-1';
    state.activeNotebookId = 'nb-1';
    state.notebook = nb1;
    state.notebookList = [
      { id: 'nb-1', title: 'NB1', updated_at: '2025-01-01' },
      { id: 'nb-2', title: 'NB2', updated_at: '2025-01-01' },
    ];

    await state.deleteNotebook('nb-1');

    // Active tab should switch to nb-2
    expect(state.activeNotebookTabId).toBe('nb-2');
    expect(state.notebook).toBe(nb2);
  });

  it('handles deletion of non-active tab (keeps current active)', async () => {
    const { state } = createCombinedSlice();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as any);

    const nb1 = makeNotebookObj('NB1');
    const nb2 = makeNotebookObj('NB2');
    state.openNotebooks = {
      'nb-1': { notebook: nb1, sessionId: 's1', scrollY: 0, workspaceDir: null },
      'nb-2': { notebook: nb2, sessionId: 's2', scrollY: 0, workspaceDir: null },
    };
    state.activeNotebookTabId = 'nb-1';
    state.activeNotebookId = 'nb-1';
    state.notebook = nb1;
    state.notebookList = [
      { id: 'nb-1', title: 'NB1', updated_at: '2025-01-01' },
      { id: 'nb-2', title: 'NB2', updated_at: '2025-01-01' },
    ];

    await state.deleteNotebook('nb-2');

    // nb-2 removed from openNotebooks
    expect(state.openNotebooks).not.toHaveProperty('nb-2');
    // Active tab stays as nb-1
    expect(state.activeNotebookTabId).toBe('nb-1');
  });
});
