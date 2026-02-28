/**
 * uiSlice tests — interaction contract regression.
 *
 * Tests:
 * - leftSidebarSplitRatio default and clamping
 * - openFileTab / closeFileTab / setActiveFileTab / deactivateFileTab / closeAllFileTabs
 * - fileViewerMaximized toggle
 * - rightPanelOpen toggle
 */

import { describe, it, expect } from 'vitest';
import { createUiSlice } from '../store/uiSlice';

// ── Minimal slice test harness ─────────────────────────────────────────────

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

  const slice = createUiSlice(set as any, get, {} as any);
  Object.assign(state, slice);

  return { state, getAction: (name: string) => (state as any)[name].bind(state) };
}

// ── leftSidebarSplitRatio ──────────────────────────────────────────────────

describe('leftSidebarSplitRatio', () => {
  it('defaults to 0.5', () => {
    const { state } = createTestSlice();
    expect(state.leftSidebarSplitRatio).toBe(0.5);
  });

  it('setLeftSidebarSplitRatio sets to valid value', () => {
    const { state, getAction } = createTestSlice();
    getAction('setLeftSidebarSplitRatio')(0.6);
    expect(state.leftSidebarSplitRatio).toBe(0.6);
  });

  it('clamps value below 0.2 to 0.2', () => {
    const { state, getAction } = createTestSlice();
    getAction('setLeftSidebarSplitRatio')(0.1);
    expect(state.leftSidebarSplitRatio).toBe(0.2);
  });

  it('clamps value above 0.8 to 0.8', () => {
    const { state, getAction } = createTestSlice();
    getAction('setLeftSidebarSplitRatio')(0.95);
    expect(state.leftSidebarSplitRatio).toBe(0.8);
  });

  it('clamps exactly at boundaries', () => {
    const { state, getAction } = createTestSlice();
    getAction('setLeftSidebarSplitRatio')(0.2);
    expect(state.leftSidebarSplitRatio).toBe(0.2);
    getAction('setLeftSidebarSplitRatio')(0.8);
    expect(state.leftSidebarSplitRatio).toBe(0.8);
  });
});

// ── Multi-file tab management ─────────────────────────────────────────────

describe('openFileTab', () => {
  it('adds a file tab and activates it', () => {
    const { state, getAction } = createTestSlice();
    getAction('openFileTab')({ path: 'report.pdf', source: 'deliverables', sessionId: 's1' });
    expect(state.openFiles).toEqual({
      'deliverables::report.pdf': { path: 'report.pdf', source: 'deliverables', sessionId: 's1', loading: true },
    });
    expect(state.activeFileTabId).toBe('deliverables::report.pdf');
  });

  it('accepts workspace source', () => {
    const { state, getAction } = createTestSlice();
    getAction('openFileTab')({ path: 'file.txt', source: 'workspace', sessionId: 's1' });
    expect(state.openFiles['workspace::file.txt']?.source).toBe('workspace');
    expect(state.activeFileTabId).toBe('workspace::file.txt');
  });

  it('accepts library source', () => {
    const { state, getAction } = createTestSlice();
    getAction('openFileTab')({ path: 'ref.pdf', source: 'library', sessionId: 's1' });
    expect(state.openFiles['library::ref.pdf']?.source).toBe('library');
  });

  it('re-opening same file activates existing tab without duplicating', () => {
    const { state, getAction } = createTestSlice();
    getAction('openFileTab')({ path: 'a.txt', source: 'workspace', sessionId: 's1' });
    getAction('openFileTab')({ path: 'b.txt', source: 'workspace', sessionId: 's1' });
    getAction('openFileTab')({ path: 'a.txt', source: 'workspace', sessionId: 's1' });
    expect(Object.keys(state.openFiles)).toHaveLength(2);
    expect(state.activeFileTabId).toBe('workspace::a.txt');
  });

  it('opens multiple files as separate tabs', () => {
    const { state, getAction } = createTestSlice();
    getAction('openFileTab')({ path: 'a.txt', source: 'workspace', sessionId: 's1' });
    getAction('openFileTab')({ path: 'b.txt', source: 'workspace', sessionId: 's1' });
    expect(Object.keys(state.openFiles)).toHaveLength(2);
    expect(state.activeFileTabId).toBe('workspace::b.txt');
  });
});

describe('closeFileTab', () => {
  it('removes tab and auto-selects next', () => {
    const { state, getAction } = createTestSlice();
    getAction('openFileTab')({ path: 'a.txt', source: 'workspace', sessionId: 's1' });
    getAction('openFileTab')({ path: 'b.txt', source: 'workspace', sessionId: 's1' });
    // active is b, close b → a becomes active
    getAction('closeFileTab')('workspace::b.txt');
    expect(Object.keys(state.openFiles)).toHaveLength(1);
    expect(state.activeFileTabId).toBe('workspace::a.txt');
  });

  it('sets activeFileTabId to null when last tab is closed', () => {
    const { state, getAction } = createTestSlice();
    getAction('openFileTab')({ path: 'a.txt', source: 'workspace', sessionId: 's1' });
    getAction('closeFileTab')('workspace::a.txt');
    expect(Object.keys(state.openFiles)).toHaveLength(0);
    expect(state.activeFileTabId).toBeNull();
  });

  it('keeps activeFileTabId unchanged when closing inactive tab', () => {
    const { state, getAction } = createTestSlice();
    getAction('openFileTab')({ path: 'a.txt', source: 'workspace', sessionId: 's1' });
    getAction('openFileTab')({ path: 'b.txt', source: 'workspace', sessionId: 's1' });
    // active is b, close a → b stays active
    getAction('closeFileTab')('workspace::a.txt');
    expect(state.activeFileTabId).toBe('workspace::b.txt');
  });
});

describe('setActiveFileTab', () => {
  it('switches active tab', () => {
    const { state, getAction } = createTestSlice();
    getAction('openFileTab')({ path: 'a.txt', source: 'workspace', sessionId: 's1' });
    getAction('openFileTab')({ path: 'b.txt', source: 'workspace', sessionId: 's1' });
    getAction('setActiveFileTab')('workspace::a.txt');
    expect(state.activeFileTabId).toBe('workspace::a.txt');
  });
});

describe('deactivateFileTab', () => {
  it('sets activeFileTabId to null without removing tabs', () => {
    const { state, getAction } = createTestSlice();
    getAction('openFileTab')({ path: 'a.txt', source: 'workspace', sessionId: 's1' });
    getAction('deactivateFileTab')();
    expect(state.activeFileTabId).toBeNull();
    expect(Object.keys(state.openFiles)).toHaveLength(1);
  });
});

describe('closeAllFileTabs', () => {
  it('clears all tabs and deactivates', () => {
    const { state, getAction } = createTestSlice();
    getAction('openFileTab')({ path: 'a.txt', source: 'workspace', sessionId: 's1' });
    getAction('openFileTab')({ path: 'b.txt', source: 'workspace', sessionId: 's1' });
    getAction('closeAllFileTabs')();
    expect(state.openFiles).toEqual({});
    expect(state.activeFileTabId).toBeNull();
  });
});

// ── filesPanelOpen removed ─────────────────────────────────────────────────

describe('filesPanelOpen removal', () => {
  it('does not have filesPanelOpen in initial state', () => {
    const { state } = createTestSlice();
    expect(state).not.toHaveProperty('filesPanelOpen');
  });

  it('does not have toggleFilesPanel action', () => {
    const { state } = createTestSlice();
    expect(state).not.toHaveProperty('toggleFilesPanel');
  });
});

// ── Interaction contract regression ─────────────────────────────────────

describe('interaction contract regression', () => {
  it('fileViewerMaximized defaults to false', () => {
    const { state } = createTestSlice();
    expect(state.fileViewerMaximized).toBe(false);
  });

  it('toggleFileViewerMaximized flips the flag', () => {
    const { state, getAction } = createTestSlice();
    getAction('toggleFileViewerMaximized')();
    expect(state.fileViewerMaximized).toBe(true);
    getAction('toggleFileViewerMaximized')();
    expect(state.fileViewerMaximized).toBe(false);
  });

  it('rightPanelOpen defaults to false (closed at project list level)', () => {
    const { state } = createTestSlice();
    expect(state.rightPanelOpen).toBe(false);
  });

  it('toggleRightPanel flips rightPanelOpen', () => {
    const { state, getAction } = createTestSlice();
    getAction('toggleRightPanel')();
    expect(state.rightPanelOpen).toBe(true);
    getAction('toggleRightPanel')();
    expect(state.rightPanelOpen).toBe(false);
  });

  it('openFiles defaults to empty and activeFileTabId defaults to null', () => {
    const { state } = createTestSlice();
    expect(state.openFiles).toEqual({});
    expect(state.activeFileTabId).toBeNull();
  });
});

// ── Library empty sessionId tab ─────────────────────────────────────────

describe('library empty sessionId tab', () => {
  it('opens a library file tab with empty sessionId', () => {
    const { state, getAction } = createTestSlice();
    getAction('openFileTab')({ path: 'ref.pdf', source: 'library', sessionId: '' });
    expect(state.openFiles['library::ref.pdf']).toBeDefined();
    expect(state.openFiles['library::ref.pdf'].sessionId).toBe('');
    expect(state.activeFileTabId).toBe('library::ref.pdf');
  });
});

// ── projectId support — file preview without active session ─────────────

describe('openFileTab with projectId', () => {
  it('preserves projectId in openFiles entry', () => {
    const { state, getAction } = createTestSlice();
    getAction('openFileTab')({ path: 'report.pdf', source: 'deliverables', sessionId: '', projectId: 'proj-1' });
    const entry = state.openFiles['deliverables::report.pdf'];
    expect(entry).toBeDefined();
    expect(entry.projectId).toBe('proj-1');
    expect(entry.sessionId).toBe('');
  });

  it('works for workspace files with projectId and no sessionId', () => {
    const { state, getAction } = createTestSlice();
    getAction('openFileTab')({ path: 'src/main.ts', source: 'workspace', sessionId: '', projectId: 'proj-2' });
    const entry = state.openFiles['workspace::src/main.ts'];
    expect(entry).toBeDefined();
    expect(entry.projectId).toBe('proj-2');
  });

  it('projectId is undefined when not provided (backward compat)', () => {
    const { state, getAction } = createTestSlice();
    getAction('openFileTab')({ path: 'a.txt', source: 'workspace', sessionId: 's1' });
    const entry = state.openFiles['workspace::a.txt'];
    expect(entry.projectId).toBeUndefined();
  });
});

// ── sidebarWidth / rightPanelWidth ──────────────────────────────────────

describe('sidebarWidth', () => {
  it('defaults to 272', () => {
    const { state } = createTestSlice();
    expect(state.sidebarWidth).toBe(272);
  });

  it('setSidebarWidth sets to valid value', () => {
    const { state, getAction } = createTestSlice();
    getAction('setSidebarWidth')(350);
    expect(state.sidebarWidth).toBe(350);
  });

  it('clamps below 120 to 120', () => {
    const { state, getAction } = createTestSlice();
    getAction('setSidebarWidth')(100);
    expect(state.sidebarWidth).toBe(120);
  });

  it('clamps above 500 to 500', () => {
    const { state, getAction } = createTestSlice();
    getAction('setSidebarWidth')(600);
    expect(state.sidebarWidth).toBe(500);
  });

  it('accepts boundary values exactly', () => {
    const { state, getAction } = createTestSlice();
    getAction('setSidebarWidth')(120);
    expect(state.sidebarWidth).toBe(120);
    getAction('setSidebarWidth')(500);
    expect(state.sidebarWidth).toBe(500);
  });
});

describe('rightPanelWidth', () => {
  it('defaults to 300', () => {
    const { state } = createTestSlice();
    expect(state.rightPanelWidth).toBe(300);
  });

  it('setRightPanelWidth sets to valid value', () => {
    const { state, getAction } = createTestSlice();
    getAction('setRightPanelWidth')(400);
    expect(state.rightPanelWidth).toBe(400);
  });

  it('clamps below 120 to 120', () => {
    const { state, getAction } = createTestSlice();
    getAction('setRightPanelWidth')(50);
    expect(state.rightPanelWidth).toBe(120);
  });

  it('clamps above 500 to 500', () => {
    const { state, getAction } = createTestSlice();
    getAction('setRightPanelWidth')(999);
    expect(state.rightPanelWidth).toBe(500);
  });

  it('accepts boundary values exactly', () => {
    const { state, getAction } = createTestSlice();
    getAction('setRightPanelWidth')(180);
    expect(state.rightPanelWidth).toBe(180);
    getAction('setRightPanelWidth')(500);
    expect(state.rightPanelWidth).toBe(500);
  });
});

// ── setRightPanelOpen ──────────────────────────────────────────────────

describe('setRightPanelOpen', () => {
  it('explicitly sets rightPanelOpen to true', () => {
    const { state, getAction } = createTestSlice();
    expect(state.rightPanelOpen).toBe(false);
    getAction('setRightPanelOpen')(true);
    expect(state.rightPanelOpen).toBe(true);
  });

  it('explicitly sets rightPanelOpen to false', () => {
    const { state, getAction } = createTestSlice();
    getAction('setRightPanelOpen')(true);
    expect(state.rightPanelOpen).toBe(true);
    getAction('setRightPanelOpen')(false);
    expect(state.rightPanelOpen).toBe(false);
  });

  it('idempotent: setting true when already true', () => {
    const { state, getAction } = createTestSlice();
    getAction('setRightPanelOpen')(true);
    expect(state.rightPanelOpen).toBe(true);
  });
});

// ── closeProjectFileTabs ──────────────────────────────────────────────

describe('closeProjectFileTabs', () => {
  function setupTabsForProject(state: any, getAction: any) {
    // Open tabs for project "proj-1"
    getAction('openFileTab')({ path: '.deliverables/report.pdf', source: 'deliverables', sessionId: 's1', projectId: 'proj-1' });
    getAction('openFileTab')({ path: '.worktrees/task-nb-a/.deliverables/spec.md', source: 'deliverables', sessionId: 's1', projectId: 'proj-1' });
    getAction('openFileTab')({ path: 'src/main.ts', source: 'workspace', sessionId: 's1', projectId: 'proj-1' });
    // Open tabs for project "proj-2"
    getAction('openFileTab')({ path: '.deliverables/other.pdf', source: 'deliverables', sessionId: 's2', projectId: 'proj-2' });
    // Open a tab without projectId (standalone notebook)
    getAction('openFileTab')({ path: 'notes.md', source: 'workspace', sessionId: 's3' });
  }

  it('closes all file tabs belonging to a specific project', () => {
    const { state, getAction } = createTestSlice();
    setupTabsForProject(state, getAction);
    expect(Object.keys(state.openFiles).length).toBe(5);

    getAction('closeProjectFileTabs')('proj-1');

    expect(Object.keys(state.openFiles).length).toBe(2);
    // proj-2 and standalone tabs remain
    expect(state.openFiles['deliverables::.deliverables/other.pdf']).toBeDefined();
    expect(state.openFiles['workspace::notes.md']).toBeDefined();
  });

  it('resets activeFileTabId when the active tab is closed', () => {
    const { state, getAction } = createTestSlice();
    setupTabsForProject(state, getAction);
    // Make a proj-1 tab active
    getAction('setActiveFileTab')('deliverables::.deliverables/report.pdf');
    expect(state.activeFileTabId).toBe('deliverables::.deliverables/report.pdf');

    getAction('closeProjectFileTabs')('proj-1');

    // Active tab should fallback to a remaining tab or null
    expect(state.activeFileTabId).not.toBe('deliverables::.deliverables/report.pdf');
  });

  it('keeps activeFileTabId when the active tab belongs to a different project', () => {
    const { state, getAction } = createTestSlice();
    setupTabsForProject(state, getAction);
    getAction('setActiveFileTab')('deliverables::.deliverables/other.pdf');

    getAction('closeProjectFileTabs')('proj-1');

    expect(state.activeFileTabId).toBe('deliverables::.deliverables/other.pdf');
  });

  it('with pathPrefix closes only tabs whose path starts with the prefix', () => {
    const { state, getAction } = createTestSlice();
    setupTabsForProject(state, getAction);
    expect(Object.keys(state.openFiles).length).toBe(5);

    // Close only notebook-a's worktree tabs within proj-1
    getAction('closeProjectFileTabs')('proj-1', '.worktrees/task-nb-a/');

    expect(Object.keys(state.openFiles).length).toBe(4);
    // The worktree tab is gone
    expect(state.openFiles['deliverables::.worktrees/task-nb-a/.deliverables/spec.md']).toBeUndefined();
    // Other proj-1 tabs remain
    expect(state.openFiles['deliverables::.deliverables/report.pdf']).toBeDefined();
    expect(state.openFiles['workspace::src/main.ts']).toBeDefined();
  });

  it('no-op when projectId has no matching tabs', () => {
    const { state, getAction } = createTestSlice();
    setupTabsForProject(state, getAction);
    const before = Object.keys(state.openFiles).length;

    getAction('closeProjectFileTabs')('nonexistent');

    expect(Object.keys(state.openFiles).length).toBe(before);
  });
});
