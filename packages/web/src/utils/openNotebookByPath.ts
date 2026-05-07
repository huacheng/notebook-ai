import { useStore } from '../store';
import * as lz4 from 'lz4js';

export interface OpenNotebookResult {
  switched?: boolean;
  opened?: boolean;
  notebookId?: string;
  error?: string;
}

/**
 * Open a .notebook.json file by its absolute path.
 * Shared by desktop (ProjectSidebar) and mobile (MobileNotebookView).
 *
 * - If already open, switches to that tab.
 * - Otherwise opens via WS (preferred) or REST fallback.
 * - Sets sessionNotice on error (D3-1).
 * - Listens for WS close to reject early (D3-4).
 */
export async function openNotebookByPath(notebookPath: string): Promise<OpenNotebookResult> {
  const { openNotebooks, setActiveNotebookTab, deactivateFileTab } = useStore.getState();

  // Derive workspace dir from notebook path
  const wsDir = notebookPath.replace(/\/[^/]+$/, '');

  // Check if already open — switch tab
  for (const [nbId, entry] of Object.entries(openNotebooks)) {
    if (entry.workspaceDir === wsDir) {
      deactivateFileTab();
      setActiveNotebookTab(nbId);
      return { switched: true, notebookId: nbId };
    }
  }

  deactivateFileTab();
  useStore.setState({ notebookLoading: true });

  try {
    const { ws, openNotebookTab: openTab } = useStore.getState();

    if (ws && ws.readyState === WebSocket.OPEN) {
      const requestId = crypto.randomUUID();
      const opened = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 180_000);

        function onOpened(e: Event) {
          const d = (e as CustomEvent).detail;
          if (d.request_id === requestId) { cleanup(); resolve(d); }
        }
        function onError(e: Event) {
          const d = (e as CustomEvent).detail;
          if (d.request_id === requestId) { cleanup(); reject(new Error(d.error)); }
        }
        // D3-4: reject early if WS disconnects
        function onClose() {
          cleanup();
          reject(new Error('WebSocket disconnected while opening notebook'));
        }
        function cleanup() {
          clearTimeout(timeout);
          window.removeEventListener('nb:notebook-opened', onOpened);
          window.removeEventListener('nb:notebook-open-error', onError);
          ws!.removeEventListener('close', onClose);
        }

        window.addEventListener('nb:notebook-opened', onOpened);
        window.addEventListener('nb:notebook-open-error', onError);
        ws.addEventListener('close', onClose);
        ws.send(JSON.stringify({ type: 'open_notebook', path: notebookPath, request_id: requestId }));
      });

      openTab(opened.notebook_id, opened.notebook, opened.session_id, opened.workspace_dir);
      setActiveNotebookTab(opened.notebook_id);
      // Calculate cellsOffset from total_cells (snake_case from WS), clamp to 0
      const totalCells = opened.total_cells ?? opened.notebook.cells.length;
      const cellsOffset = Math.max(0, totalCells - opened.notebook.cells.length);
      // Note: useWebSocket hook auto-subscribes when openNotebooks changes
      useStore.setState({ notebookLoading: false, cellsOffset, loadingOlderCells: false });
      return { opened: true, notebookId: opened.notebook_id };
    } else {
      // REST fallback
      const res = await fetch('/api/notebooks/open-by-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ path: notebookPath }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      let notebook = data.notebook;
      if (data.notebook_compressed && data.compression === 'lz4') {
        const compressed = Uint8Array.from(atob(data.notebook_compressed), c => c.charCodeAt(0));
        const decompressed = lz4.decompress(compressed);
        notebook = JSON.parse(new TextDecoder().decode(decompressed));
      }
      openTab(data.notebook_id, notebook, data.session_id, data.workspace_dir);
      setActiveNotebookTab(data.notebook_id);
      // Calculate cellsOffset from totalCells (camelCase from REST), clamp to 0
      const totalCells = data.totalCells ?? notebook.cells.length;
      const cellsOffset = Math.max(0, totalCells - notebook.cells.length);
      // Note: useWebSocket hook auto-subscribes when openNotebooks changes
      useStore.setState({ notebookLoading: false, cellsOffset, loadingOlderCells: false });
      return { opened: true, notebookId: data.notebook_id };
    }
  } catch (err: any) {
    // D3-1: surface error to user
    const msg = err?.message || 'Unknown error';
    console.error('Failed to open notebook:', msg);
    useStore.setState({ notebookLoading: false, sessionNotice: `Failed to open notebook: ${msg}` });
    return { error: msg };
  }
}
