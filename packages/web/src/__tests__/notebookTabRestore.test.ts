/**
 * @vitest-environment jsdom
 *
 * Tests that switching to a notebook tab restored from cache (workspaceDir === null)
 * triggers restoreNotebook() to create a backend session, rather than just
 * switching state with a stale/empty sessionId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal mock for cacheGet/cacheSet used by notebookSlice
vi.mock('../store/cacheHelpers', () => ({
  cacheGet: () => null,
  cacheSet: () => {},
  cacheRemove: () => {},
  _cacheKey: (id: string) => `nb-${id}`,
  _loadCachedNotebook: (id: string) => ({
    version: 1,
    metadata: { title: `Cached ${id}`, created: '2025-01-01', agent: 'claude', git_repo: false },
    cells: [],
    slide: { generated: false, sections: [] },
    annotations: [],
    assets: { intermediate_files: [] },
  }),
  TTL: { NOTEBOOK: 86400000, LAST_NOTEBOOK: 86400000 },
}));

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

  return { state, set, get };
}

describe('notebook tab restore on switch', () => {
  let testSlice: ReturnType<typeof createTestSlice>;

  beforeEach(() => {
    testSlice = createTestSlice();
  });

  it('should call restoreNotebook when switching to a tab with workspaceDir === null', () => {
    const { state } = testSlice;

    // Simulate two tabs restored from cache (workspaceDir is null — no backend session)
    state.openNotebooks = {
      'nb-1': { notebook: { metadata: { title: 'NB1' } }, sessionId: '', scrollY: 0, workspaceDir: null },
      'nb-2': { notebook: { metadata: { title: 'NB2' } }, sessionId: '', scrollY: 0, workspaceDir: null },
    };
    state.activeNotebookTabId = 'nb-1';
    state.sessionId = '';

    // Mock restoreNotebook on the state
    const restoreNotebookSpy = vi.fn().mockResolvedValue(undefined);
    state.restoreNotebook = restoreNotebookSpy;

    // Switch to nb-2 (which has no backend session)
    state.setActiveNotebookTab('nb-2');

    // restoreNotebook should be called to create a backend session
    expect(restoreNotebookSpy).toHaveBeenCalledWith('nb-2');
  });

  it('should NOT call restoreNotebook when switching to a tab with valid workspaceDir', () => {
    const { state } = testSlice;

    // Tab nb-1 has a real backend session (workspaceDir is set)
    state.openNotebooks = {
      'nb-1': { notebook: { metadata: { title: 'NB1' } }, sessionId: 'sess-1', scrollY: 0, workspaceDir: '/some/path' },
      'nb-2': { notebook: { metadata: { title: 'NB2' } }, sessionId: 'sess-2', scrollY: 0, workspaceDir: '/other/path' },
    };
    state.activeNotebookTabId = 'nb-1';
    state.sessionId = 'sess-1';

    const restoreNotebookSpy = vi.fn().mockResolvedValue(undefined);
    state.restoreNotebook = restoreNotebookSpy;

    // Switch to nb-2 (which has a valid backend session)
    state.setActiveNotebookTab('nb-2');

    // restoreNotebook should NOT be called
    expect(restoreNotebookSpy).not.toHaveBeenCalled();
  });
});
