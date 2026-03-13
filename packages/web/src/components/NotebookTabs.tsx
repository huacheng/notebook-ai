import { useStore } from '../store';

const MAX_TAB_CHARS = 20;
function truncate(s: string): string {
  return s.length > MAX_TAB_CHARS ? s.slice(0, MAX_TAB_CHARS) + '…' : s;
}

/** Session connection status indicator — spinner while connecting, hidden when ready */
function SessionStatus({ sessionId }: { sessionId: string }) {
  const status = useStore(s => s.sessionReadyStatus[sessionId]);
  const wsStatus = useStore(s => s.wsStatus);

  // Show spinner only when connecting (WS connected but session not ready yet)
  if (wsStatus === 'connected' && status === 'subscribing') {
    return <span className="session-status-spinner" title="Connecting..." />;
  }
  // All other states: hidden (ready, disconnected, unknown)
  return null;
}

export function NotebookTabs({ inSplitView, splitRatio }: {
  inSplitView?: boolean;
  splitRatio?: number;
}) {
  const openNotebooks = useStore(s => s.openNotebooks);
  const activeNotebookTabId = useStore(s => s.activeNotebookTabId);
  const tabNotifications = useStore(s => s.tabNotifications);
  const setActiveNotebookTab = useStore(s => s.setActiveNotebookTab);
  const closeNotebookTab = useStore(s => s.closeNotebookTab);
  const openFiles = useStore(s => s.openFiles);
  const activeFileTabId = useStore(s => s.activeFileTabId);
  const setActiveFileTab = useStore(s => s.setActiveFileTab);
  const closeFileTab = useStore(s => s.closeFileTab);
  const deactivateFileTab = useStore(s => s.deactivateFileTab);

  const notebookTabs = Object.entries(openNotebooks);
  const fileTabs = Object.entries(openFiles);

  if (notebookTabs.length === 0 && fileTabs.length === 0) return null;

  const hasActiveFile = activeFileTabId !== null;

  // ── Split-view mode: two tab groups ────────────────────────────────
  if (inSplitView) {
    return (
      <div
        className="notebook-tabs notebook-tabs--split"
        style={{ '--split-ratio': splitRatio ?? 0.5 } as React.CSSProperties}
      >
        <div className="notebook-tabs-left">
          {fileTabs.map(([tabId, file]) => (
            <div
              key={tabId}
              className={`notebook-tab notebook-tab--file${tabId === activeFileTabId ? ' notebook-tab--active' : ''}${file.loading ? ' notebook-tab--loading' : ''}`}
              onClick={() => setActiveFileTab(tabId)}
            >
              {file.loading && <span className="notebook-tab-spinner" />}
              <span className="notebook-tab-title" title={file.path}>{truncate(file.path.split('/').pop() ?? '')}</span>
              <button
                className="notebook-tab-close"
                onClick={e => { e.stopPropagation(); closeFileTab(tabId); }}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
        <div className="notebook-tabs-right">
          {notebookTabs.map(([id, { notebook, sessionId }]) => (
            <div
              key={id}
              className={`notebook-tab${id === activeNotebookTabId ? ' notebook-tab--active' : ''}${tabNotifications[id] ? ' notebook-tab--notify' : ''}`}
              onClick={() => setActiveNotebookTab(id)}
            >
              <SessionStatus sessionId={sessionId} />
              {tabNotifications[id] && <span className="notebook-tab-badge" />}
              <span className="notebook-tab-title" title={notebook.metadata.title}>{truncate(notebook.metadata.title)}</span>
              <button
                className="notebook-tab-close"
                onClick={e => { e.stopPropagation(); closeNotebookTab(id); }}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Normal mode: single tab strip ──────────────────────────────────
  return (
    <div className="notebook-tabs">
      {notebookTabs.map(([id, { notebook, sessionId }]) => (
        <div
          key={id}
          className={`notebook-tab${id === activeNotebookTabId && !hasActiveFile ? ' notebook-tab--active' : ''}${tabNotifications[id] ? ' notebook-tab--notify' : ''}`}
          onClick={() => { deactivateFileTab(); setActiveNotebookTab(id); }}
        >
          <SessionStatus sessionId={sessionId} />
          {tabNotifications[id] && <span className="notebook-tab-badge" />}
          <span className="notebook-tab-title" title={notebook.metadata.title}>{truncate(notebook.metadata.title)}</span>
          <button
            className="notebook-tab-close"
            onClick={e => { e.stopPropagation(); closeNotebookTab(id); }}
          >
            &times;
          </button>
        </div>
      ))}
      {fileTabs.map(([tabId, file]) => (
        <div
          key={tabId}
          className={`notebook-tab notebook-tab--file${tabId === activeFileTabId ? ' notebook-tab--active' : ''}${file.loading ? ' notebook-tab--loading' : ''}`}
          onClick={() => setActiveFileTab(tabId)}
        >
          {file.loading && <span className="notebook-tab-spinner" />}
          <span className="notebook-tab-title" title={file.path.split('/').pop()}>{truncate(file.path.split('/').pop() ?? '')}</span>
          <button
            className="notebook-tab-close"
            onClick={e => { e.stopPropagation(); closeFileTab(tabId); }}
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
