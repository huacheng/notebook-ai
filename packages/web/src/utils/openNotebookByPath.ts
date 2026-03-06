import { useStore } from '../store';

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
    const { ws, openNotebookTab: openTab, subscribeToSession: sub, authToken: token } = useStore.getState();

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
      sub(opened.session_id);
      useStore.setState({ notebookLoading: false });
      return { opened: true, notebookId: opened.notebook_id };
    } else {
      // REST fallback
      const res = await fetch(`/api/notebooks/open?path=${encodeURIComponent(notebookPath)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      openTab(data.notebook_id, data.notebook, data.session_id, data.workspace_dir);
      setActiveNotebookTab(data.notebook_id);
      sub(data.session_id);
      useStore.setState({ notebookLoading: false });
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
