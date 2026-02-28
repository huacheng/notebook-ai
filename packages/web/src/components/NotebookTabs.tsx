import { useStore } from '../store';

const MAX_TAB_CHARS = 20;
function truncate(s: string): string {
  return s.length > MAX_TAB_CHARS ? s.slice(0, MAX_TAB_CHARS) + '…' : s;
}

export function NotebookTabs({ inSplitView, splitRatio }: {
  inSplitView?: boolean;
  splitRatio?: number;
}) {
  const openNotebooks = useStore(s => s.openNotebooks);
  const activeNotebookTabId = useStore(s => s.activeNotebookTabId);
  const setActiveNotebookTab = useStore(s => s.setActiveNotebookTab);
  const closeNotebookTab = useStore(s => s.closeNotebookTab);
  const gitTabOpen = useStore(s => s.gitTabOpen);
  const openGitTab = useStore(s => s.openGitTab);
  const closeGitTab = useStore(s => s.closeGitTab);
  const activeProjectId = useStore(s => s.activeProjectId);
  const projects = useStore(s => s.projects);
  const openFiles = useStore(s => s.openFiles);
  const activeFileTabId = useStore(s => s.activeFileTabId);
  const setActiveFileTab = useStore(s => s.setActiveFileTab);
  const closeFileTab = useStore(s => s.closeFileTab);
  const deactivateFileTab = useStore(s => s.deactivateFileTab);

  const notebookTabs = Object.entries(openNotebooks);
  const fileTabs = Object.entries(openFiles);
  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null;

  if (notebookTabs.length === 0 && !activeProject && fileTabs.length === 0) return null;

  const hasActiveFile = activeFileTabId !== null;

  // ── Git tab (shared between modes, never closable) ─────────────────
  const gitTabEl = activeProject ? (
    <div
      className={`notebook-tab notebook-tab--git${gitTabOpen && !hasActiveFile ? ' notebook-tab--active' : ''}`}
      onClick={() => {
        if (inSplitView) {
          openGitTab();
        } else {
          deactivateFileTab(); openGitTab();
        }
      }}
    >
      <span className="notebook-tab-title" title={`Git(${activeProject.title})`}>{truncate(`Git(${activeProject.title})`)}</span>
    </div>
  ) : null;

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
        <div className="notebook-tabs-right">
          {notebookTabs.map(([id, { notebook }]) => (
            <div
              key={id}
              className={`notebook-tab${id === activeNotebookTabId && !gitTabOpen ? ' notebook-tab--active' : ''}`}
              onClick={() => { closeGitTab(); setActiveNotebookTab(id); }}
            >
              <span className="notebook-tab-title" title={notebook.metadata.title}>{truncate(notebook.metadata.title)}</span>
              <button
                className="notebook-tab-close"
                onClick={e => { e.stopPropagation(); closeNotebookTab(id); }}
              >
                &times;
              </button>
            </div>
          ))}
          {gitTabEl}
        </div>
      </div>
    );
  }

  // ── Normal mode: single tab strip ──────────────────────────────────
  return (
    <div className="notebook-tabs">
      {notebookTabs.map(([id, { notebook }]) => (
        <div
          key={id}
          className={`notebook-tab${id === activeNotebookTabId && !gitTabOpen && !hasActiveFile ? ' notebook-tab--active' : ''}`}
          onClick={() => { closeGitTab(); deactivateFileTab(); setActiveNotebookTab(id); }}
        >
          <span className="notebook-tab-title" title={notebook.metadata.title}>{truncate(notebook.metadata.title)}</span>
          <button
            className="notebook-tab-close"
            onClick={e => { e.stopPropagation(); closeNotebookTab(id); }}
          >
            &times;
          </button>
        </div>
      ))}
      {gitTabEl}
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
