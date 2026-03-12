import { cacheSet, cacheGet, cacheRemove, TTL } from '../utils/localCache';
import { _cacheKey, _loadCachedNotebook, _persistNotebook } from './cacheHelpers';
import type { StateCreator } from 'zustand';
import type {
  Cell,
  CellType,
  CellOutput,
  PromptCell,
  MarkdownCell,
  SlideSection,
} from '@notebook-ai/shared';
import type { NotebookStore } from './types';
import { initialAutoStatus } from './autoStatusSlice';
import {
  appendOutputToNotebook,
  setCellStatusInNotebook,
  updateToolResultInNotebook,
  setCellGitDiffInNotebook,
} from './notebookMutations';

// D1-3: Per-cell adaptive sync timers (Map<cellId, timer>) to avoid
// losing edits when quickly switching between cells.
const _sourceSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();

// D3: Cell load timeout timers to prevent stuck loading states
const _cellLoadTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const CELL_LOAD_TIMEOUT = 30_000; // 30s timeout for cell load requests

/** Persist open notebook tab IDs + active tab + sessionIds to localStorage */
function _persistNotebookTabs(openNotebooks: Record<string, { sessionId?: string; [k: string]: unknown }>, activeId: string | null) {
  try {
    const sessionIds: Record<string, string> = {};
    for (const [tabId, entry] of Object.entries(openNotebooks)) {
      if (entry.sessionId) sessionIds[tabId] = entry.sessionId;
    }
    cacheSet('nb-open-tabs', { tabs: Object.keys(openNotebooks), activeId, sessionIds }, TTL.LAST_NOTEBOOK);
  } catch { /* localStorage unavailable in test/SSR */ }
}

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

/**
 * Sync updated notebook to both top-level state.notebook and openNotebooks entry.
 * Prevents drift between the two when local mutations happen before WS broadcasts.
 */
function _syncNotebook(
  state: Pick<NotebookStore, 'notebook' | 'openNotebooks' | 'activeNotebookTabId'>,
  updated: NonNullable<NotebookStore['notebook']>,
): Partial<Pick<NotebookStore, 'notebook' | 'openNotebooks'>> {
  const result: Partial<Pick<NotebookStore, 'notebook' | 'openNotebooks'>> = { notebook: updated };
  const tabId = state.activeNotebookTabId;
  if (tabId && state.openNotebooks[tabId]) {
    result.openNotebooks = {
      ...state.openNotebooks,
      [tabId]: { ...state.openNotebooks[tabId], notebook: updated },
    };
  }
  return result;
}

export const createNotebookSlice: StateCreator<NotebookStore, [], [], Pick<NotebookStore,
  | 'notebook' | 'slideLoading' | 'notebookLoading'
  | 'cellsOffset' | 'loadingOlderCells'
  | 'setNotebook' | 'updateTitle' | 'updateAgent' | 'addCell' | 'submitPrompt' | 'removeCell' | 'moveCell'
  | 'updateCellSource' | 'setCellStatus' | 'appendCellOutput' | 'updateToolResult'
  | 'setCellGitDiff'
  | 'prependCells' | 'setCellsOffset'
  | 'generateSlide' | 'updateSlideSections'
  | 'openNotebooks' | 'activeNotebookTabId' | 'tabNotifications' | 'streamBuffer'
  | 'openNotebookTab' | 'closeNotebookTab' | 'closeNotebookTabByPath' | 'closeProjectNotebookTabs' | 'setActiveNotebookTab' | 'restoreOpenNotebookTabs'
  | 'appendStreamDelta' | 'flushStreamBuffer' | 'setTabNotification'
  | 'loadingCellIds' | 'acceptedCellIds' | 'requestCellLoad' | 'replaceCellStub'
>> = (set, get) => ({
  notebook: null,
  slideLoading: false,
  notebookLoading: false,
  cellsOffset: 0,
  loadingOlderCells: false,
  openNotebooks: {},
  activeNotebookTabId: null,
  tabNotifications: {},
  streamBuffer: {},
  loadingCellIds: new Set<string>(),
  acceptedCellIds: new Set<string>(),

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

  submitPrompt(source, images) {
    // Intercept frontend slash commands before sending to backend
    const cmd = source.trim().toLowerCase();
    if (cmd === '/model') { get().openModelPanel(); return; }
    if (cmd === '/clear') { get().clearSession(); return; }

    const cell = makeCell('prompt');
    const cellWithSource = { ...cell, source, ...(images && images.length > 0 ? { images } : {}) };
    set((state) => {
      if (!state.notebook) return {};
      const updated = {
        ...state.notebook,
        cells: [...state.notebook.cells, cellWithSource],
        metadata: { ...state.notebook.metadata, updated: new Date().toISOString() },
      };
      return _syncNotebook(state, updated);
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

    // Adaptive sync to server: max(200ms, latency × 3), per-cell timer
    const existingTimer = _sourceSyncTimers.get(cellId);
    if (existingTimer) clearTimeout(existingTimer);
    const latency = get().latency ?? 30;
    const interval = Math.max(200, latency * 3);
    _sourceSyncTimers.set(cellId, setTimeout(() => {
      _sourceSyncTimers.delete(cellId);
      const { ws, sessionId } = get();
      if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
        ws.send(JSON.stringify({
          type: 'update_cell_source',
          session_id: sessionId,
          cell_id: cellId,
          source,
        }));
      }
    }, interval));
  },

  setCellStatus(cellId, status) {
    set((state) => {
      if (!state.notebook) return {};
      return { notebook: setCellStatusInNotebook(state.notebook, cellId, status) };
    });
  },

  appendCellOutput(cellId, output: CellOutput) {
    set((state) => {
      if (!state.notebook) return {};
      return { notebook: appendOutputToNotebook(state.notebook, cellId, output) };
    });
  },

  updateToolResult(cellId, toolUseId, content, isError) {
    set((state) => {
      if (!state.notebook) return {};
      return { notebook: updateToolResultInNotebook(state.notebook, cellId, toolUseId, content, isError ?? false) };
    });
  },

  setCellGitDiff(cellId, diff) {
    set((state) => {
      if (!state.notebook) return {};
      return { notebook: setCellGitDiffInNotebook(state.notebook, cellId, diff) };
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

  async generateSlide() {
    const { sessionId } = get();
    if (!sessionId) return;

    set({ slideLoading: true });
    try {
      const headers: Record<string, string> = {};
      const token = get().authToken;
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(
        `/api/notebooks/${encodeURIComponent(sessionId)}/generate-slide`,
        { method: 'POST', headers },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[store] generateSlide failed:', body);
        return;
      }
      const { sections } = (await res.json()) as { sections: SlideSection[] };
      set((state) => {
        if (!state.notebook) return {};
        return {
          notebook: {
            ...state.notebook,
            slide: {
              generated: true,
              sections,
              updated_at: new Date().toISOString(),
            },
          },
        };
      });
    } catch (err) {
      console.error('[store] generateSlide error:', err);
    } finally {
      set({ slideLoading: false });
    }
  },

  updateSlideSections(sections: SlideSection[]) {
    set((state) => {
      if (!state.notebook) return {};
      return {
        notebook: {
          ...state.notebook,
          slide: {
            ...state.notebook.slide,
            sections,
            updated_at: new Date().toISOString(),
          },
        },
      };
    });

    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'slide_update', session_id: get().sessionId ?? '', sections }));
    }
  },

  openNotebookTab: (notebookId, notebook, sessionId, workspaceDir) => {
    set(state => {
      const newOpen = {
        ...state.openNotebooks,
        [notebookId]: { notebook, sessionId, scrollY: 0, workspaceDir: workspaceDir ?? null },
      };
      _persistNotebookTabs(newOpen, notebookId);
      // Restore per-session auto status
      const savedAutoStatus = sessionId ? state.autoStatuses?.[sessionId] : null;
      return {
        openNotebooks: newOpen,
        activeNotebookId: notebookId,
        activeNotebookTabId: notebookId,
        notebook: notebook,  // keep backward compat
        sessionId,
        workspaceDir: workspaceDir ?? state.workspaceDir,
        gitTabOpen: false,
        activeTab: 'notebook' as const,
        autoStatus: savedAutoStatus ?? { ...initialAutoStatus },
      };
    });
    // Cache notebook data so it can be restored after page refresh
    _persistNotebook(notebookId, notebook);
  },

  closeNotebookTab: (notebookId) => {
    // Unsubscribe from session before removing tab state
    const closingEntry = get().openNotebooks[notebookId];
    if (closingEntry?.sessionId && typeof get().unsubscribeFromSession === 'function') {
      get().unsubscribeFromSession(closingEntry.sessionId);
    }

    set(state => {
      const { [notebookId]: _, ...rest } = state.openNotebooks;
      const remainingIds = Object.keys(rest);
      const newActiveId = state.activeNotebookTabId === notebookId
        ? (remainingIds[0] ?? null)
        : state.activeNotebookTabId;
      _persistNotebookTabs(rest, newActiveId);
      return {
        openNotebooks: rest,
        activeNotebookTabId: newActiveId,
        notebook: newActiveId ? rest[newActiveId]?.notebook ?? null : null,
        sessionId: newActiveId ? rest[newActiveId]?.sessionId ?? null : null,
        workspaceDir: newActiveId ? rest[newActiveId]?.workspaceDir ?? null : null,
        editMode: false,
        pendingDeletes: new Set<string>(),
      };
    });
  },

  closeNotebookTabByPath: (wsPath: string) => {
    const normalized = wsPath.replace(/\/+$/, '');
    const match = Object.entries(get().openNotebooks).find(([, e]) => e.workspaceDir === normalized);
    if (match) {
      const [notebookId, entry] = match;
      // Clean up cached notebook data (same as deleteNotebook)
      cacheRemove(_cacheKey(notebookId));
      if (entry.notebook?.cells) {
        for (const cell of entry.notebook.cells) {
          cacheRemove(`nb-draft-${cell.id}`);
        }
      }
      get().closeNotebookTab(notebookId);
    }
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
      _persistNotebookTabs(rest, newActiveId);
      return {
        openNotebooks: rest,
        activeNotebookTabId: newActiveId,
        notebook: newActiveId ? rest[newActiveId]?.notebook ?? null : null,
        sessionId: newActiveId ? rest[newActiveId]?.sessionId ?? null : null,
        workspaceDir: newActiveId ? rest[newActiveId]?.workspaceDir ?? null : null,
        editMode: false,
        pendingDeletes: new Set<string>(),
      };
    });
  },

  setActiveNotebookTab: (notebookId) => {
    const entry = get().openNotebooks[notebookId];
    // If the tab was restored from cache (no backend session), trigger a full
    // restoreNotebook() to create a backend session instead of just switching state.
    if (entry && entry.workspaceDir === null && typeof get().restoreNotebook === 'function') {
      get().restoreNotebook(notebookId);
      return;
    }
    const newSessionId = entry?.sessionId ?? null;
    set(state => {
      _persistNotebookTabs(state.openNotebooks, notebookId);
      // Restore per-session auto status
      const savedAutoStatus = newSessionId ? state.autoStatuses?.[newSessionId] : null;
      // Clear tab notification for the newly active tab
      const updatedNotifications = { ...state.tabNotifications };
      delete updatedNotifications[notebookId];
      return {
        openNotebooks: state.openNotebooks,
        activeNotebookId: notebookId,
        activeNotebookTabId: notebookId,
        notebook: state.openNotebooks[notebookId]?.notebook ?? null,
        sessionId: newSessionId,
        workspaceDir: state.openNotebooks[notebookId]?.workspaceDir ?? null,
        openFile: null, // C3: clear FileViewer when switching tabs
        editMode: false,
        pendingDeletes: new Set<string>(),
        autoStatus: savedAutoStatus ?? { ...initialAutoStatus },
        tabNotifications: updatedNotifications,
      };
    });
    // Subscribe to the new session to receive updates
    if (newSessionId && typeof get().subscribeToSession === 'function') {
      get().subscribeToSession(newSessionId);
    }
  },

  restoreOpenNotebookTabs: () => {
    const saved = cacheGet<{ tabs: string[]; activeId: string | null; sessionIds?: Record<string, string> }>('nb-open-tabs', TTL.LAST_NOTEBOOK);
    if (!saved || saved.tabs.length === 0) return;
    const openNotebooks: Record<string, { notebook: any; sessionId: string; scrollY: number; workspaceDir: string | null }> = {};
    for (const tabId of saved.tabs) {
      const cached = _loadCachedNotebook(tabId);
      if (cached) {
        // sessionId is always '' after page refresh — old backend sessions are gone.
        // workspaceDir: null signals setActiveNotebookTab to call restoreNotebook().
        openNotebooks[tabId] = { notebook: cached, sessionId: '', scrollY: 0, workspaceDir: null };
      }
    }
    const tabIds = Object.keys(openNotebooks);
    if (tabIds.length === 0) return;
    const activeId = saved.activeId && openNotebooks[saved.activeId] ? saved.activeId : tabIds[0];
    set({
      openNotebooks,
      activeNotebookTabId: activeId,
      sessionId: null, // No backend session yet
    });
    // Trigger backend session creation for ALL open tabs (not just active).
    // This ensures all notebooks are subscribed and ready to use.
    if (typeof get().restoreNotebook === 'function') {
      // Restore active tab first for better UX
      for (const tabId of tabIds) {
        if (tabId === activeId) {
          get().restoreNotebook(tabId);
        }
      }
      // Then restore other tabs in background
      for (const tabId of tabIds) {
        if (tabId !== activeId) {
          get().restoreNotebook(tabId);
        }
      }
    }
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

  setTabNotification: (notebookId, hasNotification) => {
    set(state => {
      const updated = { ...state.tabNotifications };
      if (hasNotification) {
        updated[notebookId] = true;
      } else {
        delete updated[notebookId];
      }
      return { tabNotifications: updated };
    });
  },

  // ── Cell lazy loading ────────────────────────────────────────────────────
  requestCellLoad: (cellId: string) => {
    const { ws, sessionId, loadingCellIds } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId) return;
    if (loadingCellIds.has(cellId)) return; // prevent duplicate requests

    // Mark as loading
    set(state => ({
      loadingCellIds: new Set([...state.loadingCellIds, cellId]),
    }));

    // D3: Set timeout to clean up stuck loading state
    const timeoutId = setTimeout(() => {
      _cellLoadTimeouts.delete(cellId);
      set(state => {
        const newLoadingIds = new Set(state.loadingCellIds);
        if (newLoadingIds.has(cellId)) {
          newLoadingIds.delete(cellId);
          console.warn(`[cell-load] Timeout loading cell ${cellId}`);
          return { loadingCellIds: newLoadingIds };
        }
        return {};
      });
    }, CELL_LOAD_TIMEOUT);
    _cellLoadTimeouts.set(cellId, timeoutId);

    // Send cell_load request
    ws.send(JSON.stringify({
      type: 'cell_load',
      request_id: crypto.randomUUID(),
      session_id: sessionId,
      cell_id: cellId,
    }));
  },

  replaceCellStub: (cellId: string, fullCell: Cell) => {
    // D3: Clear timeout timer on successful response
    const timeoutId = _cellLoadTimeouts.get(cellId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      _cellLoadTimeouts.delete(cellId);
    }

    set(state => {
      const newLoadingIds = new Set(state.loadingCellIds);
      newLoadingIds.delete(cellId);

      // Update state.notebook
      const updatedNotebook = state.notebook
        ? {
            ...state.notebook,
            cells: state.notebook.cells.map(c => c.id === cellId ? fullCell : c),
          }
        : null;

      // D1: Also update openNotebooks to maintain consistency across tabs
      const updatedOpenNotebooks = { ...state.openNotebooks };
      for (const [nbId, entry] of Object.entries(updatedOpenNotebooks)) {
        const idx = entry.notebook.cells.findIndex(c => c.id === cellId);
        if (idx !== -1) {
          updatedOpenNotebooks[nbId] = {
            ...entry,
            notebook: {
              ...entry.notebook,
              cells: entry.notebook.cells.map(c => c.id === cellId ? fullCell : c),
            },
          };
        }
      }

      return {
        loadingCellIds: newLoadingIds,
        notebook: updatedNotebook,
        openNotebooks: updatedOpenNotebooks,
      };
    });
  },
});
