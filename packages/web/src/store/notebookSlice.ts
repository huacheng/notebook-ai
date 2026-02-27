import type { StateCreator } from 'zustand';
import type {
  Cell,
  CellType,
  CellOutput,
  PromptCell,
  MarkdownCell,
  SliceSection,
} from '@notebook-ai/shared';
import type { NotebookStore } from './types';

// Adaptive sync timer for cell source updates
let _sourceSyncTimer: ReturnType<typeof setTimeout> | null = null;

function makeCell(type: CellType): Cell {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  if (type === 'prompt') {
    const cell: PromptCell = {
      id,
      type: 'prompt',
      source: '',
      outputs: [],
      execution_count: 0,
      status: 'idle',
      created_at: now,
      updated_at: now,
    };
    return cell;
  }

  if (type === 'markdown') {
    const cell: MarkdownCell = {
      id,
      type: 'markdown',
      source: '',
      execution_count: 0,
      status: 'idle',
      created_at: now,
      updated_at: now,
    };
    return cell;
  }

  return {
    id,
    type: 'visualization',
    source: '',
    data: null,
    execution_count: 0,
    status: 'idle',
    created_at: now,
    updated_at: now,
  };
}

export const createNotebookSlice: StateCreator<NotebookStore, [], [], Pick<NotebookStore,
  | 'notebook' | 'sliceLoading' | 'notebookLoading'
  | 'cellsOffset' | 'loadingOlderCells'
  | 'setNotebook' | 'updateTitle' | 'updateAgent' | 'addCell' | 'submitPrompt' | 'removeCell' | 'moveCell'
  | 'updateCellSource' | 'setCellStatus' | 'appendCellOutput' | 'updateToolResult'
  | 'setCellGitDiff'
  | 'prependCells' | 'setCellsOffset'
  | 'generateSlice' | 'updateSliceSections'
  | 'openNotebooks' | 'activeNotebookTabId' | 'streamBuffer'
  | 'openNotebookTab' | 'closeNotebookTab' | 'closeProjectNotebookTabs' | 'setActiveNotebookTab'
  | 'appendStreamDelta' | 'flushStreamBuffer'
>> = (set, get) => ({
  notebook: null,
  sliceLoading: false,
  notebookLoading: false,
  cellsOffset: 0,
  loadingOlderCells: false,
  openNotebooks: {},
  activeNotebookTabId: null,
  streamBuffer: {},

  setNotebook(nb) {
    set({ notebook: nb });
  },

  updateTitle(title) {
    set((state) => {
      if (!state.notebook) return {};
      return {
        notebook: {
          ...state.notebook,
          metadata: {
            ...state.notebook.metadata,
            title,
            updated: new Date().toISOString(),
          },
        },
      };
    });
  },

  updateAgent(agent) {
    set((state) => {
      if (!state.notebook) return {};
      return {
        notebook: {
          ...state.notebook,
          metadata: {
            ...state.notebook.metadata,
            agent,
            updated: new Date().toISOString(),
          },
        },
      };
    });
  },

  addCell(type, index) {
    const cell = makeCell(type);
    set((state) => {
      if (!state.notebook) return {};
      const cells = [...state.notebook.cells];
      if (index !== undefined) {
        cells.splice(index, 0, cell);
      } else {
        cells.push(cell);
      }
      return {
        notebook: {
          ...state.notebook,
          cells,
          metadata: {
            ...state.notebook.metadata,
            updated: new Date().toISOString(),
          },
        },
      };
    });
  },

  submitPrompt(source) {
    const cell = makeCell('prompt');
    const cellWithSource = { ...cell, source };
    set((state) => {
      if (!state.notebook) return {};
      return {
        notebook: {
          ...state.notebook,
          cells: [...state.notebook.cells, cellWithSource],
          metadata: { ...state.notebook.metadata, updated: new Date().toISOString() },
        },
      };
    });
    get().executeCell(cell.id);
  },

  removeCell(cellId) {
    set((state) => {
      if (!state.notebook) return {};
      return {
        notebook: {
          ...state.notebook,
          cells: state.notebook.cells.filter((c) => c.id !== cellId),
          metadata: {
            ...state.notebook.metadata,
            updated: new Date().toISOString(),
          },
        },
      };
    });
  },

  moveCell(cellId, direction) {
    set((state) => {
      if (!state.notebook) return {};
      const cells = [...state.notebook.cells];
      const idx = cells.findIndex((c) => c.id === cellId);
      if (idx === -1) return {};
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= cells.length) return {};
      [cells[idx], cells[swapIdx]] = [cells[swapIdx], cells[idx]];
      return {
        notebook: {
          ...state.notebook,
          cells,
          metadata: {
            ...state.notebook.metadata,
            updated: new Date().toISOString(),
          },
        },
      };
    });
  },

  updateCellSource(cellId, source) {
    set((state) => {
      if (!state.notebook) return {};
      return {
        notebook: {
          ...state.notebook,
          cells: state.notebook.cells.map((c) =>
            c.id === cellId ? { ...c, source, updated_at: new Date().toISOString() } : c
          ),
        },
      };
    });

    // Adaptive sync to server: max(200ms, latency × 3)
    if (_sourceSyncTimer) clearTimeout(_sourceSyncTimer);
    const latency = get().latency ?? 30;
    const interval = Math.max(200, latency * 3);
    _sourceSyncTimer = setTimeout(() => {
      _sourceSyncTimer = null;
      const { ws, sessionId } = get();
      if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
        ws.send(JSON.stringify({
          type: 'update_cell_source',
          session_id: sessionId,
          cell_id: cellId,
          source,
        }));
      }
    }, interval);
  },

  setCellStatus(cellId, status) {
    set((state) => {
      if (!state.notebook) return {};
      return {
        notebook: {
          ...state.notebook,
          cells: state.notebook.cells.map((c) =>
            c.id === cellId ? { ...c, status } : c
          ),
        },
      };
    });
  },

  appendCellOutput(cellId, output: CellOutput) {
    set((state) => {
      if (!state.notebook) return {};
      return {
        notebook: {
          ...state.notebook,
          cells: state.notebook.cells.map((c) => {
            if (c.id !== cellId || c.type !== 'prompt') return c;
            return { ...c, outputs: [...c.outputs, output] };
          }),
        },
      };
    });
  },

  updateToolResult(cellId, toolUseId, content, isError) {
    set((state) => {
      if (!state.notebook) return {};
      let matched = false;
      return {
        notebook: {
          ...state.notebook,
          cells: state.notebook.cells.map((c) => {
            if (c.id !== cellId || c.type !== 'prompt') return c;
            return {
              ...c,
              outputs: c.outputs.map((out) => {
                if (matched || out.type !== 'tool_use') return out;
                const byId = out.tool_use_id === toolUseId;
                const unresolved = !byId && out.result === undefined;
                if (byId || unresolved) {
                  matched = true;
                  return { ...out, result: content, is_error: isError };
                }
                return out;
              }),
            };
          }),
        },
      };
    });
  },

  setCellGitDiff(cellId, diff) {
    set((state) => {
      if (!state.notebook) return {};
      return {
        notebook: {
          ...state.notebook,
          cells: state.notebook.cells.map((c) => {
            if (c.id !== cellId || c.type !== 'prompt') return c;
            return { ...c, git_diff: diff };
          }),
        },
      };
    });
  },

  prependCells(cells, newOffset) {
    set((state) => {
      if (!state.notebook) return {};
      return {
        notebook: {
          ...state.notebook,
          cells: [...cells, ...state.notebook.cells],
        },
        cellsOffset: newOffset,
      };
    });
  },

  setCellsOffset(offset) {
    set({ cellsOffset: offset });
  },

  async generateSlice() {
    const { sessionId } = get();
    if (!sessionId) return;

    set({ sliceLoading: true });
    try {
      const headers: Record<string, string> = {};
      const token = get().authToken;
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(
        `/api/notebooks/${encodeURIComponent(sessionId)}/generate-slice`,
        { method: 'POST', headers },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[store] generateSlice failed:', body);
        return;
      }
      const { sections } = (await res.json()) as { sections: SliceSection[] };
      set((state) => {
        if (!state.notebook) return {};
        return {
          notebook: {
            ...state.notebook,
            slice: {
              generated: true,
              sections,
              updated_at: new Date().toISOString(),
            },
          },
        };
      });
    } catch (err) {
      console.error('[store] generateSlice error:', err);
    } finally {
      set({ sliceLoading: false });
    }
  },

  updateSliceSections(sections: SliceSection[]) {
    set((state) => {
      if (!state.notebook) return {};
      return {
        notebook: {
          ...state.notebook,
          slice: {
            ...state.notebook.slice,
            sections,
            updated_at: new Date().toISOString(),
          },
        },
      };
    });

    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'slice_update', session_id: get().sessionId ?? '', sections }));
    }
  },

  openNotebookTab: (notebookId, notebook, sessionId) => {
    set(state => ({
      openNotebooks: {
        ...state.openNotebooks,
        [notebookId]: { notebook, sessionId, scrollY: 0 },
      },
      activeNotebookTabId: notebookId,
      notebook: notebook,  // keep backward compat
      sessionId,
      gitTabOpen: false,
      activeTab: 'notebook' as const,
    }));
  },

  closeNotebookTab: (notebookId) => {
    set(state => {
      const { [notebookId]: _, ...rest } = state.openNotebooks;
      const remainingIds = Object.keys(rest);
      const newActiveId = state.activeNotebookTabId === notebookId
        ? (remainingIds[0] ?? null)
        : state.activeNotebookTabId;
      return {
        openNotebooks: rest,
        activeNotebookTabId: newActiveId,
        notebook: newActiveId ? rest[newActiveId]?.notebook ?? null : null,
        sessionId: newActiveId ? rest[newActiveId]?.sessionId ?? null : null,
        editMode: false,
        pendingDeletes: new Set<string>(),
      };
    });
  },

  closeProjectNotebookTabs: (projectId) => {
    set(state => {
      const rest: typeof state.openNotebooks = {};
      for (const [id, entry] of Object.entries(state.openNotebooks)) {
        if (entry.notebook.metadata.project_id !== projectId) {
          rest[id] = entry;
        }
      }
      const remainingIds = Object.keys(rest);
      const activeRemoved = !state.activeNotebookTabId || !(state.activeNotebookTabId in rest);
      const newActiveId = activeRemoved ? (remainingIds[0] ?? null) : state.activeNotebookTabId;
      return {
        openNotebooks: rest,
        activeNotebookTabId: newActiveId,
        notebook: newActiveId ? rest[newActiveId]?.notebook ?? null : null,
        sessionId: newActiveId ? rest[newActiveId]?.sessionId ?? null : null,
        editMode: false,
        pendingDeletes: new Set<string>(),
      };
    });
  },

  setActiveNotebookTab: (notebookId) => {
    set(state => {
      // Save scroll position for current tab
      const current = state.activeNotebookTabId;
      const updated = { ...state.openNotebooks };
      if (current && updated[current]) {
        updated[current] = { ...updated[current], scrollY: typeof window !== 'undefined' ? window.scrollY : 0 };
      }
      return {
        openNotebooks: updated,
        activeNotebookTabId: notebookId,
        notebook: updated[notebookId]?.notebook ?? null,
        sessionId: updated[notebookId]?.sessionId ?? null,
        openFile: null, // C3: clear FileViewer when switching tabs
        editMode: false,
        pendingDeletes: new Set<string>(),
      };
    });
  },

  appendStreamDelta: (cellId, delta, blockType) => {
    set(state => {
      const buf = { ...state.streamBuffer };
      if (!buf[cellId]) buf[cellId] = { text: '', thinking: '' };
      buf[cellId] = { ...buf[cellId], [blockType]: buf[cellId][blockType] + delta };
      return { streamBuffer: buf };
    });
  },

  flushStreamBuffer: (cellId) => {
    const buf = get().streamBuffer[cellId];
    if (!buf) return '';
    const text = buf.text;
    set(state => {
      const newBuf = { ...state.streamBuffer };
      delete newBuf[cellId];
      return { streamBuffer: newBuf };
    });
    return text;
  },
});
