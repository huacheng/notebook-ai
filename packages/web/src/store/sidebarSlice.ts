import type { StateCreator } from 'zustand';
import type { Notebook, NotebookListItem } from '@notebook-ai/shared';
import type { NotebookStore } from './types';
import { _cacheKey, _loadCachedNotebook, _persistNotebook } from './cacheHelpers';
import { cacheSet, cacheGet, cacheRemove, TTL } from '../utils/localCache';

function makeBlankNotebook(): Notebook {
  const now = new Date().toISOString();
  return {
    version: 1,
    metadata: {
      title: 'Untitled Notebook',
      created: now,
      updated: now,
      git_repo: false,
      agent: 'claude',
    },
    cells: [],
    slide: { generated: false, sections: [] },
    annotations: [],
    assets: { intermediate_files: [] },
  };
}

export const createSidebarSlice: StateCreator<NotebookStore, [], [], Pick<NotebookStore,
  | 'sidebarOpen' | 'notebookList' | 'notebookListLoading' | 'activeNotebookId' | 'workspaceDir'
  | 'toggleSidebar' | 'setSidebarOpen' | 'fetchNotebookList' | 'createNewNotebook'
  | 'restoreNotebook' | 'deleteNotebook' | 'renameNotebook' | 'setCreatingNotebook'
  | 'importNotebookFile'
>> = (set, get) => ({
  sidebarOpen: true,
  notebookList: [],
  notebookListLoading: false,
  activeNotebookId: null,
  workspaceDir: null,

  toggleSidebar() {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }));
  },

  setSidebarOpen(open) {
    set({ sidebarOpen: open });
  },

  async fetchNotebookList() {
    set({ notebookListLoading: true });
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const headers: Record<string, string> = {};
        const token = get().authToken;
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/notebooks/list', { headers });
        if (res.ok) {
          const data = (await res.json()) as { notebooks: NotebookListItem[] };
          const notebooks = data.notebooks.map((item) => {
            const cached = cacheGet<string>(`nb-title-${item.id}`, TTL.TITLE);
            return cached ? { ...item, title: cached } : item;
          });
          set({ notebookList: notebooks, notebookListLoading: false });

          const validIds = new Set(data.notebooks.map((n) => n.id));
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (!key) continue;
            const m = key.match(/^nb-(?:notebook|scroll|title)-(.+)$/);
            if (m && !validIds.has(m[1])) cacheRemove(key);
          }
          const lastId = cacheGet<string>('nb-last-notebook', TTL.LAST_NOTEBOOK);
          if (lastId && !validIds.has(lastId)) cacheRemove('nb-last-notebook');

          return;
        }
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 600 * attempt));
      }
    }
    if (lastErr) console.error('[store] fetchNotebookList failed:', lastErr);
    set({ notebookListLoading: false });
  },

  async createNewNotebook(title: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = get().authToken;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    set({ sessionNotice: null });
    const tempId = crypto.randomUUID();
    const blankNotebook = makeBlankNotebook();
    blankNotebook.metadata.title = title;
    set({
      notebook: blankNotebook,
      sessionId: null,
      activeNotebookId: tempId,
      workspaceDir: null,
    });

    try {
      const res = await fetch('/api/notebooks/create', {
        method: 'POST',
        headers,
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error: string };
        console.error('[store] createNewNotebook failed:', err.error);
        return;
      }
      const data = (await res.json()) as {
        notebook: Notebook;
        notebookId: string;
        sessionId: string;
        workspaceDir: string;
      };

      set({
        notebook: data.notebook,
        sessionId: data.sessionId,
        activeNotebookId: data.notebookId,
        workspaceDir: data.workspaceDir,
      });

      get().fetchNotebookList();
    } catch (err) {
      console.error('[store] createNewNotebook error:', err);
    }
  },

  async restoreNotebook(notebookId: string) {
    if (get().activeNotebookId === notebookId) {
      if (get().creatingNotebook) set({ creatingNotebook: false });
      return;
    }
    set({ creatingNotebook: false });

    const cached = _loadCachedNotebook(notebookId);
    if (cached) {
      set({
        sessionNotice: null,
        notebookLoading: false,
        activeNotebookId: notebookId,
        activeNotebookTabId: notebookId,
        notebook: cached,
        sessionId: null,
        workspaceDir: null,
      });
    } else {
      set({
        sessionNotice: null,
        notebookLoading: true,
        activeNotebookId: notebookId,
        activeNotebookTabId: notebookId,
        notebook: null,
        sessionId: null,
        workspaceDir: null,
      });
    }

    const headers: Record<string, string> = {};
    const token = get().authToken;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/restore`, {
        method: 'POST',
        headers,
      });
      if (!res.ok) {
        const err = (await res.json()) as { error: string };
        console.error('[store] restoreNotebook failed:', err.error);
        set({ notebookLoading: false, activeNotebookId: null, notebook: null });
        if (res.status === 404) {
          cacheRemove(_cacheKey(notebookId));
          if (cacheGet<string>('nb-last-notebook', TTL.LAST_NOTEBOOK) === notebookId) {
            cacheRemove('nb-last-notebook');
          }
        }
        return;
      }
      const data = (await res.json()) as {
        notebook: Notebook;
        sessionId: string;
        reconnected: boolean;
        notebookId: string;
        workspaceDir: string;
        totalCells?: number;
      };

      const totalCells = data.totalCells ?? data.notebook.cells.length;
      const cellsOffset = Math.max(0, totalCells - data.notebook.cells.length);

      set((state) => {
        // Check if user switched to a different notebook while we were loading.
        // If so, only update openNotebooks (cache the data) but don't switch active tab.
        const isStillTarget = state.activeNotebookId === data.notebookId ||
                              state.activeNotebookTabId === data.notebookId;

        const updatedOpenNotebooks = {
          ...state.openNotebooks,
          [data.notebookId]: {
            notebook: data.notebook,
            sessionId: data.sessionId,
            scrollY: state.openNotebooks[data.notebookId]?.scrollY ?? 0,
            workspaceDir: data.workspaceDir,
          },
        };

        if (!isStillTarget) {
          // User switched away — just cache the data, don't change active state
          return { openNotebooks: updatedOpenNotebooks };
        }

        return {
          notebook: data.notebook,
          sessionId: data.sessionId,
          activeNotebookId: data.notebookId,
          workspaceDir: data.workspaceDir,
          notebookLoading: false,
          cellsOffset,
          loadingOlderCells: false,
          openNotebooks: updatedOpenNotebooks,
          activeNotebookTabId: data.notebookId,
        };
      });

      _persistNotebook(data.notebookId, data.notebook);
      // Note: useWebSocket hook auto-subscribes when openNotebooks changes
      get().fetchNotebookList();
    } catch (err) {
      console.error('[store] restoreNotebook error:', err);
      set({ notebookLoading: false, activeNotebookId: null, notebook: null });
    }
  },

  async deleteNotebook(notebookId: string) {
    const headers: Record<string, string> = {};
    const token = get().authToken;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    set((state) => ({
      notebookList: state.notebookList.filter((n) => n.id !== notebookId),
    }));
    // D3-5: Capture notebook reference BEFORE clearing state to avoid dead-code bug
    const isActive = get().activeNotebookId === notebookId;
    const notebookForCleanup = isActive ? get().notebook : _loadCachedNotebook(notebookId);
    if (isActive) {
      set({ notebook: null, sessionId: null, activeNotebookId: null, workspaceDir: null });
      cacheRemove('nb-last-notebook');
    }
    // Close the notebook tab from openNotebooks if it's open
    if (notebookId in get().openNotebooks) {
      get().closeNotebookTab(notebookId);
    }
    cacheRemove(_cacheKey(notebookId));
    if (notebookForCleanup) {
      for (const cell of notebookForCleanup.cells) {
        cacheRemove(`nb-draft-${cell.id}`);
      }
    }

    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok && res.status !== 404) {
        console.error('[store] deleteNotebook failed:', res.status);
      }
    } catch (err) {
      console.error('[store] deleteNotebook error:', err);
    }
  },

  async renameNotebook(notebookId: string, newTitle: string) {
    set((state) => {
      const patch: Partial<NotebookStore> = {
        notebookList: state.notebookList.map((item) =>
          item.id === notebookId ? { ...item, title: newTitle } : item,
        ),
      };
      if (state.activeNotebookId === notebookId && state.notebook) {
        patch.notebook = {
          ...state.notebook,
          metadata: { ...state.notebook.metadata, title: newTitle, updated: new Date().toISOString() },
        };
      }
      return patch;
    });

    cacheSet(`nb-title-${notebookId}`, newTitle);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = get().authToken;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ title: newTitle }),
      });
      cacheRemove(`nb-title-${notebookId}`);
      get().fetchNotebookList();
    } catch (err) {
      console.error('[store] renameNotebook error:', err);
    }
  },

  setCreatingNotebook(v) {
    set({ creatingNotebook: v });
  },

  async importNotebookFile(file: File) {
    let imported: Notebook;
    try {
      if (file.name.endsWith('.zip')) {
        const formData = new FormData();
        formData.append('file', file);
        const headers: Record<string, string> = {};
        const token = get().authToken;
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const extractRes = await fetch('/api/notebooks/extract-zip', {
          method: 'POST',
          headers,
          body: formData,
        });
        if (!extractRes.ok) {
          const data = (await extractRes.json()) as { error: string };
          console.error('[store] extract-zip error:', data.error);
          return;
        }
        imported = (await extractRes.json()) as Notebook;
      } else {
        imported = JSON.parse(await file.text()) as Notebook;
      }
    } catch {
      return;
    }

    const title = imported.metadata?.title || 'Imported Notebook';
    set({ creatingNotebook: false, sessionNotice: null });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = get().authToken;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch('/api/notebooks/create', {
        method: 'POST',
        headers,
        body: JSON.stringify({ title }),
      });
      if (!res.ok) return;

      const data = (await res.json()) as {
        notebook: Notebook;
        notebookId: string;
        sessionId: string;
        workspaceDir: string;
      };

      const importedWithMeta: Notebook = {
        ...imported,
        metadata: {
          ...imported.metadata,
          title,
          updated: new Date().toISOString(),
        },
      };

      set({
        notebook: importedWithMeta,
        sessionId: data.sessionId,
        activeNotebookId: data.notebookId,
        workspaceDir: data.workspaceDir,
      });

      await fetch(`/api/notebooks/${encodeURIComponent(data.notebookId)}/import-content`, {
        method: 'POST',
        headers,
        body: JSON.stringify(importedWithMeta),
      });

      get().fetchNotebookList();
    } catch (err) {
      console.error('[store] importNotebookFile error:', err);
    }
  },
});
