/**
 * useNotebookActions - Unified hook for notebook operations
 *
 * Provides consistent API for both desktop and mobile UI to perform
 * notebook CRUD operations. Eliminates code duplication between
 * ProjectSidebar.tsx and MobileNotebooksList.tsx.
 */

import { useCallback } from 'react';
import { useStore } from '../store';

export interface NotebookOpenResult {
  notebookId: string;
  notebook: any;
  sessionId: string;
  workspaceDir: string;
  totalCells?: number;
  lazy?: boolean;
}

export interface NotebookCreateResult {
  notebookId: string;
  sessionId: string;
  notebookPath: string;
  worktreePath: string;
  branch: string;
}

export interface UseNotebookActionsOptions {
  /** Called when operation starts */
  onStart?: () => void;
  /** Called when operation succeeds */
  onSuccess?: () => void;
  /** Called when operation fails */
  onError?: (error: Error) => void;
}

/**
 * Hook providing unified notebook operations for desktop and mobile.
 */
export function useNotebookActions(options: UseNotebookActionsOptions = {}) {
  const authToken = useStore((s) => s.authToken);
  const ws = useStore((s) => s.ws);
  const openNotebookTab = useStore((s) => s.openNotebookTab);
  const subscribeToSession = useStore((s) => s.subscribeToSession);

  const { onStart, onSuccess, onError } = options;

  /**
   * Open an existing notebook by path.
   * Uses WebSocket if available, falls back to REST.
   */
  const openNotebook = useCallback(
    async (notebookPath: string): Promise<NotebookOpenResult> => {
      onStart?.();

      try {
        // Try WebSocket first for better performance
        if (ws && ws.readyState === WebSocket.OPEN) {
          const result = await openNotebookViaWs(ws, notebookPath);
          onSuccess?.();
          return result;
        }

        // REST fallback
        const result = await openNotebookViaRest(notebookPath, authToken);
        onSuccess?.();
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
        throw error;
      }
    },
    [ws, authToken, onStart, onSuccess, onError]
  );

  /**
   * Open notebook and register it in the store.
   * This is the high-level API that handles tab management.
   */
  const openNotebookWithTab = useCallback(
    async (notebookPath: string): Promise<void> => {
      const result = await openNotebook(notebookPath);

      openNotebookTab(
        result.notebookId,
        result.notebook,
        result.sessionId,
        result.workspaceDir
      );

      // Set cells offset if paginated
      if (result.totalCells !== undefined) {
        const cellsOffset = result.totalCells - result.notebook.cells.length;
        useStore.setState({ cellsOffset, loadingOlderCells: false });
      }

      subscribeToSession(result.sessionId);
    },
    [openNotebook, openNotebookTab, subscribeToSession]
  );

  /**
   * Create a new notebook within a project.
   */
  const createProjectNotebook = useCallback(
    async (projectId: string, title: string): Promise<NotebookCreateResult> => {
      onStart?.();

      try {
        const res = await fetch(`/api/projects/${projectId}/notebooks`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ title }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        const result = await res.json();
        onSuccess?.();
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
        throw error;
      }
    },
    [authToken, onStart, onSuccess, onError]
  );

  /**
   * Create notebook and immediately open it.
   */
  const createAndOpenNotebook = useCallback(
    async (projectId: string, title: string): Promise<void> => {
      const createResult = await createProjectNotebook(projectId, title);
      await openNotebookWithTab(createResult.notebookPath);
    },
    [createProjectNotebook, openNotebookWithTab]
  );

  /**
   * Rename a notebook by ID.
   */
  const renameNotebook = useCallback(
    async (notebookId: string, newTitle: string): Promise<void> => {
      onStart?.();

      try {
        const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ title: newTitle }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        onSuccess?.();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
        throw error;
      }
    },
    [authToken, onStart, onSuccess, onError]
  );

  /**
   * Rename a project notebook by path.
   * Used when we have path but not notebook ID.
   */
  const renameNotebookByPath = useCallback(
    async (projectId: string, notebookPath: string, newTitle: string): Promise<void> => {
      onStart?.();

      try {
        const res = await fetch(`/api/projects/${projectId}/notebooks/rename`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ notebookPath, title: newTitle }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        onSuccess?.();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
        throw error;
      }
    },
    [authToken, onStart, onSuccess, onError]
  );

  /**
   * Delete a notebook by ID.
   */
  const deleteNotebook = useCallback(
    async (notebookId: string): Promise<void> => {
      onStart?.();

      try {
        const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}`, {
          method: 'DELETE',
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        onSuccess?.();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
        throw error;
      }
    },
    [authToken, onStart, onSuccess, onError]
  );

  /**
   * Delete a project notebook by path.
   */
  const deleteProjectNotebook = useCallback(
    async (projectId: string, notebookPath: string): Promise<void> => {
      onStart?.();

      try {
        const res = await fetch(
          `/api/projects/${projectId}/notebooks/by-path?path=${encodeURIComponent(notebookPath)}`,
          {
            method: 'DELETE',
            headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
          }
        );

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        onSuccess?.();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
        throw error;
      }
    },
    [authToken, onStart, onSuccess, onError]
  );

  return {
    // Open operations
    openNotebook,
    openNotebookWithTab,

    // Create operations
    createProjectNotebook,
    createAndOpenNotebook,

    // Rename operations
    renameNotebook,
    renameNotebookByPath,

    // Delete operations
    deleteNotebook,
    deleteProjectNotebook,
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Open notebook via WebSocket for better performance.
 * Uses lazy mode by default for faster initial load.
 */
async function openNotebookViaWs(
  ws: WebSocket,
  notebookPath: string,
  lazy = true
): Promise<NotebookOpenResult> {
  const requestId = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('WebSocket timeout'));
    }, 30_000); // Increased timeout for large notebooks

    function onOpened(e: Event) {
      const d = (e as CustomEvent).detail;
      if (d.request_id === requestId) {
        cleanup();

        // Handle lazy mode: construct notebook from metadata + stubs
        if (d.lazy && d.cell_stubs && d.metadata) {
          const notebook = {
            metadata: d.metadata,
            cells: d.cell_stubs.map((stub: any) => ({
              ...stub,
              _stub: true, // Mark as stub for lazy loading
              source: stub.source_preview || '',
              outputs: [],
            })),
            slice: d.metadata.slice || { generated: false, sections: [] },
          };
          resolve({
            notebookId: d.notebook_id,
            notebook,
            sessionId: d.session_id,
            workspaceDir: d.workspace_dir,
            totalCells: d.total_cells,
            lazy: true,
          });
        } else {
          // Non-lazy mode: full notebook received
          resolve({
            notebookId: d.notebook_id,
            notebook: d.notebook,
            sessionId: d.session_id,
            workspaceDir: d.workspace_dir,
            totalCells: d.total_cells,
            lazy: false,
          });
        }
      }
    }

    function onError(e: Event) {
      const d = (e as CustomEvent).detail;
      if (d.request_id === requestId) {
        cleanup();
        reject(new Error(d.error || 'Failed to open notebook'));
      }
    }

    function cleanup() {
      clearTimeout(timeout);
      window.removeEventListener('nb:notebook-opened', onOpened);
      window.removeEventListener('nb:notebook-open-error', onError);
    }

    window.addEventListener('nb:notebook-opened', onOpened);
    window.addEventListener('nb:notebook-open-error', onError);

    ws.send(
      JSON.stringify({
        type: 'notebook_open',
        request_id: requestId,
        path: notebookPath,
        lazy, // Request lazy mode
      })
    );
  });
}

/**
 * Open notebook via REST API fallback.
 */
async function openNotebookViaRest(
  notebookPath: string,
  authToken: string | null
): Promise<NotebookOpenResult> {
  const res = await fetch('/api/notebooks/open-by-path', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ path: notebookPath }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return {
    notebookId: data.notebookId,
    notebook: data.notebook,
    sessionId: data.sessionId,
    workspaceDir: data.workspaceDir,
    totalCells: data.totalCells,
  };
}
