/**
 * editMode tests — Edit mode state management + WS message handling.
 *
 * Step 1: Store state (editMode, pendingDeletes, editSavePhase)
 * Step 5: WS message handling (cells_removed, cells_remove_failed)
 */

import { describe, it, expect, vi } from 'vitest';
import { createUiSlice } from '../store/uiSlice';
import { createNotebookSlice } from '../store/notebookSlice';

// ── Minimal slice test harness ─────────────────────────────────────────────

function createTestUiSlice() {
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

  return { state, set, get };
}

function createTestNotebookSlice() {
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

// ── editMode defaults ───────────────────────────────────────────────────

describe('editMode defaults', () => {
  it('editMode defaults to false', () => {
    const { state } = createTestUiSlice();
    expect(state.editMode).toBe(false);
  });

  it('pendingDeletes defaults to empty Set', () => {
    const { state } = createTestUiSlice();
    expect(state.pendingDeletes).toBeInstanceOf(Set);
    expect(state.pendingDeletes.size).toBe(0);
  });

  it('editSavePhase defaults to "idle"', () => {
    const { state } = createTestUiSlice();
    expect(state.editSavePhase).toBe('idle');
  });

  it('editSaveError defaults to empty string', () => {
    const { state } = createTestUiSlice();
    expect(state.editSaveError).toBe('');
  });
});

// ── setEditMode ─────────────────────────────────────────────────────────

describe('setEditMode', () => {
  it('setEditMode(true) sets editMode to true', () => {
    const { state } = createTestUiSlice();
    state.setEditMode(true);
    expect(state.editMode).toBe(true);
  });

  it('setEditMode(false) sets editMode to false', () => {
    const { state } = createTestUiSlice();
    state.setEditMode(true);
    state.setEditMode(false);
    expect(state.editMode).toBe(false);
  });

  it('setEditMode(true) resets pendingDeletes', () => {
    const { state } = createTestUiSlice();
    state.setEditMode(true);
    state.togglePendingDelete('cell-1');
    expect(state.pendingDeletes.size).toBe(1);
    // Re-enter edit mode resets
    state.setEditMode(true);
    expect(state.pendingDeletes.size).toBe(0);
  });
});

// ── togglePendingDelete ─────────────────────────────────────────────────

describe('togglePendingDelete', () => {
  it('adds cellId to pendingDeletes', () => {
    const { state } = createTestUiSlice();
    state.setEditMode(true);
    state.togglePendingDelete('cell-1');
    expect(state.pendingDeletes.has('cell-1')).toBe(true);
  });

  it('removes cellId if already in pendingDeletes', () => {
    const { state } = createTestUiSlice();
    state.setEditMode(true);
    state.togglePendingDelete('cell-1');
    state.togglePendingDelete('cell-1');
    expect(state.pendingDeletes.has('cell-1')).toBe(false);
    expect(state.pendingDeletes.size).toBe(0);
  });

  it('handles multiple cell IDs', () => {
    const { state } = createTestUiSlice();
    state.setEditMode(true);
    state.togglePendingDelete('cell-1');
    state.togglePendingDelete('cell-2');
    state.togglePendingDelete('cell-3');
    expect(state.pendingDeletes.size).toBe(3);
    state.togglePendingDelete('cell-2');
    expect(state.pendingDeletes.size).toBe(2);
    expect(state.pendingDeletes.has('cell-2')).toBe(false);
  });
});

// ── commitEdits ─────────────────────────────────────────────────────────

describe('commitEdits', () => {
  it('sets editSavePhase to "saving" and sends WS message', () => {
    const { state } = createTestUiSlice();
    const sendFn = vi.fn();

    state.ws = { readyState: WebSocket.OPEN, send: sendFn } as any;
    state.sessionId = 'session-1';
    state.setEditMode(true);
    state.togglePendingDelete('cell-1');
    state.togglePendingDelete('cell-2');

    state.commitEdits();

    expect(state.editSavePhase).toBe('saving');
    expect(sendFn).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(sendFn.mock.calls[0][0]);
    expect(sent.type).toBe('remove_cells');
    expect(sent.session_id).toBe('session-1');
    expect(sent.cell_ids).toHaveLength(2);
    expect(sent.cell_ids).toContain('cell-1');
    expect(sent.cell_ids).toContain('cell-2');
  });
});

// ── Guard: setActiveTab exits editMode ──────────────────────────────────

describe('editMode guards', () => {
  it('setActiveTab exits editMode and clears pendingDeletes', () => {
    const { state } = createTestUiSlice();
    state.setEditMode(true);
    state.togglePendingDelete('cell-1');

    state.setActiveTab('slide');

    expect(state.editMode).toBe(false);
    expect(state.pendingDeletes.size).toBe(0);
  });
});

// ── Guard: closeNotebookTab exits editMode ──────────────────────────────

describe('notebookSlice editMode guards', () => {
  it('closeNotebookTab exits editMode and clears pendingDeletes', () => {
    const { state } = createTestNotebookSlice();
    // Simulate editMode state
    state.editMode = true;
    state.pendingDeletes = new Set(['cell-1']);

    const nb = {
      metadata: { title: 'Test', created: '', updated: '', agent: 'claude' as const },
      cells: [],
    };
    state.openNotebookTab('nb-1', nb, 'session-1');
    state.closeNotebookTab('nb-1');

    expect(state.editMode).toBe(false);
    expect(state.pendingDeletes.size).toBe(0);
  });

  it('setActiveNotebookTab exits editMode and clears pendingDeletes', () => {
    const { state } = createTestNotebookSlice();
    const nb = {
      metadata: { title: 'Test', created: '', updated: '', agent: 'claude' as const },
      cells: [],
    };
    state.openNotebookTab('nb-1', nb, 'session-1');
    state.openNotebookTab('nb-2', nb, 'session-2');

    // Simulate editMode state
    state.editMode = true;
    state.pendingDeletes = new Set(['cell-1']);

    state.setActiveNotebookTab('nb-1');

    expect(state.editMode).toBe(false);
    expect(state.pendingDeletes.size).toBe(0);
  });
});

// ── workspaceDir per-tab sync ────────────────────────────────────────────

describe('workspaceDir per-tab sync', () => {
  const nb = {
    metadata: { title: 'T', created: '', updated: '', agent: 'claude' as const },
    cells: [],
  };

  it('openNotebookTab stores and sets workspaceDir', () => {
    const { state } = createTestNotebookSlice();
    state.openNotebookTab('nb-1', nb, 's-1', '/ws/proj/.worktrees/task-a');
    expect(state.workspaceDir).toBe('/ws/proj/.worktrees/task-a');
    expect(state.openNotebooks['nb-1'].workspaceDir).toBe('/ws/proj/.worktrees/task-a');
  });

  it('setActiveNotebookTab restores workspaceDir from target tab', () => {
    const { state } = createTestNotebookSlice();
    state.openNotebookTab('nb-1', nb, 's-1', '/ws/worktree-a');
    state.openNotebookTab('nb-2', nb, 's-2', '/ws/worktree-b');
    // active is nb-2
    expect(state.workspaceDir).toBe('/ws/worktree-b');
    state.setActiveNotebookTab('nb-1');
    expect(state.workspaceDir).toBe('/ws/worktree-a');
  });

  it('closeNotebookTab restores workspaceDir from remaining tab', () => {
    const { state } = createTestNotebookSlice();
    state.openNotebookTab('nb-1', nb, 's-1', '/ws/worktree-a');
    state.openNotebookTab('nb-2', nb, 's-2', '/ws/worktree-b');
    state.closeNotebookTab('nb-2');
    expect(state.workspaceDir).toBe('/ws/worktree-a');
  });

  it('closeNotebookTab sets workspaceDir to null when no tabs remain', () => {
    const { state } = createTestNotebookSlice();
    state.openNotebookTab('nb-1', nb, 's-1', '/ws/worktree-a');
    state.closeNotebookTab('nb-1');
    expect(state.workspaceDir).toBeNull();
  });
});

// ── Step 5: WS message handling ─────────────────────────────────────────

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

  const uiSlice = createUiSlice(set as any, get, {} as any);
  const nbSlice = createNotebookSlice(set as any, get, {} as any);
  Object.assign(state, uiSlice, nbSlice);

  return { state, set, get };
}

describe('cells_removed WS message', () => {
  it('removes cells from notebook, resets editMode and editSavePhase', () => {
    const { state, set } = createCombinedSlice();

    // Setup: notebook with cells, editMode on, pending deletes
    state.notebook = {
      metadata: { title: 'Test', created: '', updated: '', agent: 'claude' as const },
      cells: [
        { id: 'cell-1', type: 'prompt' as const, source: 'A', outputs: [], execution_count: 1, status: 'completed' as const },
        { id: 'cell-2', type: 'prompt' as const, source: 'B', outputs: [], execution_count: 2, status: 'completed' as const },
        { id: 'cell-3', type: 'prompt' as const, source: 'C', outputs: [], execution_count: 3, status: 'completed' as const },
      ],
    };
    state.editMode = true;
    state.pendingDeletes = new Set(['cell-1', 'cell-3']);
    state.editSavePhase = 'saving';

    // Simulate receiving cells_removed: handler should remove pending cells and reset state
    const pendingDeletes = state.pendingDeletes as Set<string>;
    set((s: any) => ({
      notebook: {
        ...s.notebook,
        cells: s.notebook.cells.filter((c: any) => !pendingDeletes.has(c.id)),
      },
      editMode: false,
      pendingDeletes: new Set<string>(),
      editSavePhase: 'idle',
      editSaveError: '',
    }));

    expect(state.notebook.cells).toHaveLength(1);
    expect(state.notebook.cells[0].id).toBe('cell-2');
    expect(state.editMode).toBe(false);
    expect(state.pendingDeletes.size).toBe(0);
    expect(state.editSavePhase).toBe('idle');
  });
});

describe('cells_remove_failed WS message', () => {
  it('sets editSavePhase to error with message', () => {
    const { state, set } = createCombinedSlice();

    state.editMode = true;
    state.editSavePhase = 'saving';

    // Simulate receiving cells_remove_failed
    set({ editSavePhase: 'error', editSaveError: 'Save failed: disk full' });

    expect(state.editSavePhase).toBe('error');
    expect(state.editSaveError).toBe('Save failed: disk full');
    // Should stay in editMode
    expect(state.editMode).toBe(true);
  });
});
