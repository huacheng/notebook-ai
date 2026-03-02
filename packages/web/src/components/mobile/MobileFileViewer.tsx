import { useEffect } from 'react';
import { useStore } from '../../store';
import { MobileHeader } from './MobileHeader';
import { MobileAnnotationBar } from './MobileAnnotationBar';
import { FileViewer } from '../FileViewer';

/**
 * Mobile FileViewer - Portrait overlay mode.
 * Full screen overlay that covers the notebook.
 */
export function MobileFileViewer() {
  const mobileFileViewerPath = useStore((s) => s.mobileFileViewerPath);
  const mobileFileViewerSource = useStore((s) => s.mobileFileViewerSource);
  const closeMobileFileViewer = useStore((s) => s.closeMobileFileViewer);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const activeNotebookTabId = useStore((s) => s.activeNotebookTabId);
  const openNotebooks = useStore((s) => s.openNotebooks);
  const openFileTab = useStore((s) => s.openFileTab);
  const closeFileTab = useStore((s) => s.closeFileTab);

  const activeTab = activeNotebookTabId ? openNotebooks[activeNotebookTabId] : null;
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

  // Cleanup file tab when component unmounts or file viewer closes
  useEffect(() => {
    return () => {
      // Use getState() to get current value, avoiding stale closure
      const currentTabId = useStore.getState().activeFileTabId;
      if (currentTabId) {
        closeFileTab(currentTabId);
      }
    };
  }, [closeFileTab]);

  if (!mobileFileViewerPath || !mobileFileViewerSource) {
    return null;
  }

  // Extract filename from path
  const filename = mobileFileViewerPath.split('/').pop() || 'File';

  return (
    <div className="mobile-view mobile-file-viewer">
      <MobileHeader
        title={filename}
        showBack
        onBack={closeMobileFileViewer}
      />

      <main className="mobile-content mobile-file-content">
        <FileViewer />
      </main>

      <MobileAnnotationBar filePath={mobileFileViewerPath} />
    </div>
  );
}
