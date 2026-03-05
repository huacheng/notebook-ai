/**
 * Tab persistence — notebook and file tabs survive page refresh.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createNotebookSlice } from '../store/notebookSlice';
import { createUiSlice } from '../store/uiSlice';
import { cacheGet, cacheSet, TTL } from '../utils/localCache';

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

function makeNotebookObj(title = 'Test') {
  return {
    version: 1,
    metadata: { title, created: '2025-01-01', agent: 'claude' as const, git_repo: false },
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
  Object.assign(state, createNotebookSlice(set as any, get, {} as any));
  Object.assign(state, createUiSlice(set as any, get, {} as any));
  return { state };
}

beforeEach(() => {
  localStorageMock.clear();
});

// ── Notebook tab persistence ──────────────────────────────────────────

describe('notebook tab persistence', () => {
  it('saves open notebook tab IDs to localStorage on openNotebookTab', () => {
    const { state } = createCombinedSlice();
    const nb = makeNotebookObj('NB1');

    state.openNotebookTab('nb-1', nb, 's1', '/w1');

    const saved = cacheGet<{ tabs: string[]; activeId: string | null }>('nb-open-tabs', TTL.LAST_NOTEBOOK);
    expect(saved).not.toBeNull();
    expect(saved!.tabs).toContain('nb-1');
    expect(saved!.activeId).toBe('nb-1');
  });

  it('updates localStorage when closing a notebook tab', () => {
    const { state } = createCombinedSlice();
    state.openNotebookTab('nb-1', makeNotebookObj('NB1'), 's1', '/w1');
    state.openNotebookTab('nb-2', makeNotebookObj('NB2'), 's2', '/w2');

    state.closeNotebookTab('nb-1');

    const saved = cacheGet<{ tabs: string[]; activeId: string | null }>('nb-open-tabs', TTL.LAST_NOTEBOOK);
    expect(saved!.tabs).toEqual(['nb-2']);
    expect(saved!.tabs).not.toContain('nb-1');
  });

  it('updates activeId on setActiveNotebookTab', () => {
    const { state } = createCombinedSlice();
    state.openNotebookTab('nb-1', makeNotebookObj('NB1'), 's1', '/w1');
    state.openNotebookTab('nb-2', makeNotebookObj('NB2'), 's2', '/w2');

    state.setActiveNotebookTab('nb-1');

    const saved = cacheGet<{ tabs: string[]; activeId: string | null }>('nb-open-tabs', TTL.LAST_NOTEBOOK);
    expect(saved!.activeId).toBe('nb-1');
  });
});

// ── File tab persistence ──────────────────────────────────────────────

describe('file tab persistence', () => {
  it('saves open file tabs to localStorage on openFileTab', () => {
    const { state } = createCombinedSlice();

    state.openFileTab({ path: 'hello.py', source: 'workspace', sessionId: 's1', projectId: 'p1' });

    const saved = cacheGet<{ tabs: { tabId: string; path: string; source: string; projectId?: string }[]; activeId: string | null }>('nb-open-files', TTL.LAST_NOTEBOOK);
    expect(saved).not.toBeNull();
    expect(saved!.tabs).toHaveLength(1);
    expect(saved!.tabs[0].path).toBe('hello.py');
    expect(saved!.tabs[0].source).toBe('workspace');
    expect(saved!.activeId).toBe('workspace::hello.py');
  });

  it('removes file tab from localStorage on closeFileTab', () => {
    const { state } = createCombinedSlice();
    state.openFileTab({ path: 'a.py', source: 'workspace', sessionId: 's1', projectId: 'p1' });
    state.openFileTab({ path: 'b.py', source: 'library', sessionId: 's1' });

    state.closeFileTab('workspace::a.py');

    const saved = cacheGet<{ tabs: any[]; activeId: string | null }>('nb-open-files', TTL.LAST_NOTEBOOK);
    expect(saved!.tabs).toHaveLength(1);
    expect(saved!.tabs[0].path).toBe('b.py');
  });

  it('clears file tabs from localStorage on closeAllFileTabs', () => {
    const { state } = createCombinedSlice();
    state.openFileTab({ path: 'a.py', source: 'workspace', sessionId: 's1', projectId: 'p1' });

    state.closeAllFileTabs();

    const saved = cacheGet<{ tabs: any[]; activeId: string | null }>('nb-open-files', TTL.LAST_NOTEBOOK);
    expect(saved).not.toBeNull();
    expect(saved!.tabs).toHaveLength(0);
    expect(saved!.activeId).toBeNull();
  });
});

// ── Restore logic ─────────────────────────────────────────────────────

describe('restoreOpenNotebookTabs', () => {
  it('restores notebook tabs from localStorage cache', () => {
    // Pre-populate: save tab IDs
    cacheSet('nb-open-tabs', { tabs: ['nb-1', 'nb-2'], activeId: 'nb-2' }, TTL.LAST_NOTEBOOK);
    // Pre-populate: cache notebook data
    cacheSet('nb-notebook-nb-1', makeNotebookObj('NB1'), TTL.NOTEBOOK);
    cacheSet('nb-notebook-nb-2', makeNotebookObj('NB2'), TTL.NOTEBOOK);

    const { state } = createCombinedSlice();
    state.restoreOpenNotebookTabs();

    expect(Object.keys(state.openNotebooks)).toHaveLength(2);
    expect(state.openNotebooks['nb-1']).toBeDefined();
    expect(state.openNotebooks['nb-2']).toBeDefined();
    expect(state.activeNotebookTabId).toBe('nb-2');
  });

  it('skips tabs with no cached data', () => {
    cacheSet('nb-open-tabs', { tabs: ['nb-1', 'nb-missing'], activeId: 'nb-1' }, TTL.LAST_NOTEBOOK);
    cacheSet('nb-notebook-nb-1', makeNotebookObj('NB1'), TTL.NOTEBOOK);
    // nb-missing has no cache

    const { state } = createCombinedSlice();
    state.restoreOpenNotebookTabs();

    expect(Object.keys(state.openNotebooks)).toHaveLength(1);
    expect(state.openNotebooks['nb-1']).toBeDefined();
  });

  it('does nothing when no saved tabs exist', () => {
    const { state } = createCombinedSlice();
    state.restoreOpenNotebookTabs();
    expect(Object.keys(state.openNotebooks)).toHaveLength(0);
  });
});

describe('restoreOpenFileTabs', () => {
  it('restores file tabs from localStorage', () => {
    // Pre-populate localStorage with saved file tabs
    cacheSet('nb-open-files', {
      tabs: [
        { tabId: 'workspace::hello.py', path: 'hello.py', source: 'workspace', projectId: 'p1' },
        { tabId: 'library::lib.md', path: 'lib.md', source: 'library' },
      ],
      activeId: 'library::lib.md',
    }, TTL.LAST_NOTEBOOK);

    const { state } = createCombinedSlice();
    state.restoreOpenFileTabs();

    expect(Object.keys(state.openFiles)).toHaveLength(2);
    expect(state.openFiles['workspace::hello.py']).toBeDefined();
    expect(state.openFiles['workspace::hello.py'].path).toBe('hello.py');
    expect(state.openFiles['library::lib.md']).toBeDefined();
    expect(state.activeFileTabId).toBe('library::lib.md');
  });

  it('does nothing when no saved file tabs exist', () => {
    const { state } = createCombinedSlice();
    state.restoreOpenFileTabs();
    expect(Object.keys(state.openFiles)).toHaveLength(0);
    expect(state.activeFileTabId).toBeNull();
  });
});
