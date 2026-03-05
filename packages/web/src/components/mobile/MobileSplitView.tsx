import { useRef, useEffect } from 'react';
import { useStore } from '../../store';
import { MobileAnnotationBar } from './MobileAnnotationBar';
import { MobileInputBar } from './MobileInputBar';
import { FileViewer } from '../FileViewer';
import { Cell } from '../Cell';

/**
 * Mobile Split View - Landscape mode.
 * FileViewer on left, Notebook on right.
 */
export function MobileSplitView() {
  const mobileFileViewerPath = useStore((s) => s.mobileFileViewerPath);
  const mobileFileViewerSource = useStore((s) => s.mobileFileViewerSource);
  const closeMobileFileViewer = useStore((s) => s.closeMobileFileViewer);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const activeNotebookTabId = useStore((s) => s.activeNotebookTabId);
  const openNotebooks = useStore((s) => s.openNotebooks);
  const setMobileView = useStore((s) => s.setMobileView);
  const toggleLeftDrawer = useStore((s) => s.toggleLeftDrawer);
  const toggleRightDrawer = useStore((s) => s.toggleRightDrawer);
  const openFileTab = useStore((s) => s.openFileTab);
  const closeFileTab = useStore((s) => s.closeFileTab);
  const editMode = useStore((s) => s.editMode);
  const pendingDeletes = useStore((s) => s.pendingDeletes);
  const togglePendingDelete = useStore((s) => s.togglePendingDelete);

  const notebookRef = useRef<HTMLDivElement>(null);

  const activeTab = activeNotebookTabId ? openNotebooks[activeNotebookTabId] : null;
  const notebook = activeTab?.notebook;
  const sessionId = activeTab?.sessionId || '';

  // Sync mobile file viewer state to desktop FileViewer store
  useEffect(() => {
    if (mobileFileViewerPath && mobileFileViewerSource && sessionId) {
      openFileTab({
        path: mobileFileViewerPath,
        source: mobileFileViewerSource,
        sessionId,
        projectId: activeProjectId || undefined,
      });
    }
  }, [mobileFileViewerPath, mobileFileViewerSource, sessionId, activeProjectId, openFileTab]);

  // Cleanup file tab when component unmounts
  useEffect(() => {
    return () => {
      const currentTabId = useStore.getState().activeFileTabId;
      if (currentTabId) {
        closeFileTab(currentTabId);
      }
    };
  }, [closeFileTab]);

  // Auto-scroll notebook to bottom
  useEffect(() => {
    if (notebookRef.current && notebook?.cells) {
      const el = notebookRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [notebook?.cells?.length]);

  if (!mobileFileViewerPath || !mobileFileViewerSource) {
    return null;
  }

  const filename = mobileFileViewerPath.split('/').pop() || 'File';
  const notebookTitle = notebook?.metadata?.title || 'Notebook';

  return (
    <div className="mobile-split-view">
      {/* Left side - FileViewer */}
      <div className="mobile-split-left">
        <header className="mobile-split-header">
          <button
            className="mobile-menu-btn"
            onClick={toggleLeftDrawer}
            aria-label="Open workspace"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <h1 className="mobile-split-title">{filename}</h1>
          <button
            className="mobile-close-btn"
            onClick={closeMobileFileViewer}
            aria-label="Close file"
          >
            ×
          </button>
        </header>

        <div className="mobile-split-content">
          <FileViewer />
        </div>

        <MobileAnnotationBar filePath={mobileFileViewerPath} />
      </div>

      {/* Right side - Notebook */}
      <div className="mobile-split-right">
        <header className="mobile-split-header">
          <button
            className="mobile-back-btn"
            onClick={() => setMobileView('notebooks')}
            aria-label="Go back"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <h1 className="mobile-split-title">{notebookTitle}</h1>
          <button
            className="mobile-menu-btn"
            onClick={toggleRightDrawer}
            aria-label="Open deliverables"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </header>

        <div className="mobile-split-content" ref={notebookRef}>
          <div className="mobile-cells">
            {notebook?.cells.map((cell, index) => (
              <Cell key={cell.id} cell={cell} index={index} editMode={editMode} pendingDelete={pendingDeletes.has(cell.id)} onToggleDelete={togglePendingDelete} />
            ))}
          </div>
        </div>

        <MobileInputBar />
      </div>
    </div>
  );
}
