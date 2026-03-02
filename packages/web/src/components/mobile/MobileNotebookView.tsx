import { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { MobileHeader } from './MobileHeader';
import { MobileDrawer } from './MobileDrawer';
import { MobileInputBar } from './MobileInputBar';
import { MobileFileViewer } from './MobileFileViewer';
import { MobileSplitView } from './MobileSplitView';
import { MobileModelSheet } from './MobileModelSheet';
import { MobilePluginSheet } from './MobilePluginSheet';
import { MobileNotebookActions } from './MobileNotebookActions';
import { Cell } from '../Cell';
import { FileSection } from '../FileSection';
import { useOrientation } from '../../hooks/useOrientation';
import { useWatcher } from '../../hooks/useWatcher';
import { getDeliverablesPath } from '../../utils/deliverablesPath';
import { shouldShowScrollBtn } from '../../utils/scrollToBottom';

/**
 * Mobile Notebook View (Level 3)
 * The main notebook interaction interface for mobile.
 */
export function MobileNotebookView() {
  const t = useT();
  const orientation = useOrientation();
  const setMobileView = useStore((s) => s.setMobileView);
  const leftDrawerOpen = useStore((s) => s.leftDrawerOpen);
  const rightDrawerOpen = useStore((s) => s.rightDrawerOpen);
  const closeDrawers = useStore((s) => s.closeDrawers);
  const mobileFileViewerOpen = useStore((s) => s.mobileFileViewerOpen);
  const openMobileFileViewer = useStore((s) => s.openMobileFileViewer);

  // Use main notebook state (same as desktop) for consistency with lazy loading
  const notebook = useStore((s) => s.notebook);
  const cellsOffset = useStore((s) => s.cellsOffset);
  const loadingOlderCells = useStore((s) => s.loadingOlderCells);
  const cells = notebook?.cells ?? [];

  // File section state (same as desktop for consistency)
  const activeProjectId = useStore((s) => s.activeProjectId);
  const activeProjectPath = useStore((s) => s.activeProjectPath);
  const workspaceDir = useStore((s) => s.workspaceDir);
  const sessionId = useStore((s) => s.sessionId);
  const authToken = useStore((s) => s.authToken);

  // Refresh keys for file sections
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0);
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);
  const [delivRefreshKey, setDelivRefreshKey] = useState(0);

  // Calculate deliverables path
  const delivPath = getDeliverablesPath(workspaceDir, activeProjectPath);

  // WS-based file change detection (same as desktop)
  useWatcher('files', { projectId: activeProjectId, dirPath: workspaceDir ?? undefined });
  useWatcher('files', { projectId: activeProjectId, dirPath: delivPath });

  // Listen for file change events
  useEffect(() => {
    const handler = () => {
      setWorkspaceRefreshKey(k => k + 1);
      setDelivRefreshKey(k => k + 1);
    };
    window.addEventListener('nb:files-changed', handler);
    return () => window.removeEventListener('nb:files-changed', handler);
  }, []);

  // Library change listener
  useEffect(() => {
    const handler = () => setLibraryRefreshKey(k => k + 1);
    window.addEventListener('nb:library-changed', handler);
    return () => window.removeEventListener('nb:library-changed', handler);
  }, []);

  // File click handlers
  const handleWorkspaceFileClick = (subPath: string, name: string) => {
    const relPath = subPath === '.' ? name : `${subPath}/${name}`;
    openMobileFileViewer(relPath, 'workspace');
    closeDrawers();
  };

  const handleLibraryFileClick = (subPath: string, name: string) => {
    const relPath = subPath === '.' ? name : `${subPath}/${name}`;
    openMobileFileViewer(relPath, 'library');
    closeDrawers();
  };

  const handleDelivFileClick = (subPath: string, name: string) => {
    const relPath = subPath === '.' ? name : `${subPath}/${name}`;
    openMobileFileViewer(relPath, 'deliverables');
    closeDrawers();
  };

  const contentRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevHeightRef = useRef(0);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // Auto-scroll to bottom when new cells are added (not on prepend)
  useEffect(() => {
    if (contentRef.current && cells.length > 0) {
      const el = contentRef.current;
      // Only auto-scroll if we're near the bottom already
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      if (isNearBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [cells.length]);

  // Scroll position preservation after prepending older cells
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const prevHeight = prevHeightRef.current;
    if (prevHeight > 0 && el.scrollHeight > prevHeight) {
      el.scrollTop += el.scrollHeight - prevHeight;
    }
    prevHeightRef.current = el.scrollHeight;
  }, [cells.length, cellsOffset]);

  // Scroll-to-bottom button visibility (same logic as desktop)
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const handleScroll = () => {
      setShowScrollBtn(shouldShowScrollBtn(el.scrollTop, el.scrollHeight, el.clientHeight));
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    // Initial check
    handleScroll();
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // Load more cells handler (same as desktop, but BATCH=2)
  const handleLoadMore = useCallback(() => {
    const { ws, sessionId, loadingOlderCells: isLoading } = useStore.getState();
    if (isLoading || !ws || ws.readyState !== WebSocket.OPEN || !sessionId) return;
    const BATCH = 2;
    const newOffset = Math.max(0, cellsOffset - BATCH);
    const limit = cellsOffset - newOffset;
    if (limit <= 0) return;
    ws.send(JSON.stringify({ type: 'load_cells', session_id: sessionId, offset: newOffset, limit }));
    useStore.setState({ loadingOlderCells: true });
  }, [cellsOffset]);

  // IntersectionObserver: auto-load older cells when sentinel becomes visible
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || cellsOffset <= 0) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) handleLoadMore(); },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cellsOffset, handleLoadMore]);

  const handleBack = () => {
    setMobileView('notebooks');
  };

  // If file viewer is open, show appropriate layout based on orientation
  if (mobileFileViewerOpen) {
    if (orientation === 'landscape') {
      return <MobileSplitView />;
    }
    return <MobileFileViewer />;
  }

  if (!notebook) {
    return (
      <div className="mobile-view mobile-notebook-view">
        <MobileHeader title="Notebook" showBack onBack={handleBack} />
        <main className="mobile-content">
          <div className="mobile-loading">Loading notebook...</div>
        </main>
      </div>
    );
  }

  // Get notebook title from metadata or first cell
  const title = notebook.metadata?.title || 'Notebook';

  return (
    <div className="mobile-view mobile-notebook-view">
      <MobileHeader
        title={title}
        showBack
        onBack={handleBack}
        showLeftMenu
        showRightMenu
        rightContent={
          <>
            {/* Notebook actions (Edit, Restart, Rerun, Save, Export, Slice) */}
            <MobileNotebookActions />
            {/* Plugin button */}
            <button
              className="mobile-header-btn"
              onClick={() => useStore.getState().openPluginPanel()}
              aria-label="Plugins"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 3.5a1.5 1.5 0 013 0V4a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-.5a1.5 1.5 0 000 3h.5a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-.5a1.5 1.5 0 00-3 0v.5a1 1 0 01-1 1H6a1 1 0 01-1-1v-3a1 1 0 00-1-1h-.5a1.5 1.5 0 010-3H4a1 1 0 001-1V6a1 1 0 011-1h3a1 1 0 001-1v-.5z" />
              </svg>
            </button>
            {/* Model button */}
            <button
              className="mobile-header-btn"
              onClick={() => useStore.getState().openModelPanel()}
              aria-label="Model"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </>
        }
      />

      {/* Left Drawer - Workspace + Library */}
      <MobileDrawer open={leftDrawerOpen} side="left" onClose={closeDrawers}>
        <div className="mobile-drawer-content">
          <div className="mobile-drawer-header">
            <h2>{t('sidebar.workspace')}</h2>
          </div>
          <div className="mobile-drawer-section mobile-drawer-file-section">
            {activeProjectId ? (
              <FileSection
                baseUrl={`/api/projects/${activeProjectId}`}
                authToken={authToken}
                onFileClick={handleWorkspaceFileClick}
                refreshKey={workspaceRefreshKey}
              />
            ) : (
              <p className="mobile-drawer-placeholder">{t('sidebar.noProject')}</p>
            )}
          </div>
          <div className="mobile-drawer-divider" />
          <div className="mobile-drawer-header">
            <h2>{t('sidebar.library')}</h2>
          </div>
          <div className="mobile-drawer-section mobile-drawer-file-section">
            <FileSection
              baseUrl="/api/library"
              authToken={authToken}
              onFileClick={handleLibraryFileClick}
              refreshKey={libraryRefreshKey}
              workspaceDir={workspaceDir}
            />
          </div>
        </div>
      </MobileDrawer>

      {/* Right Drawer - Deliverables */}
      <MobileDrawer open={rightDrawerOpen} side="right" onClose={closeDrawers}>
        <div className="mobile-drawer-content">
          <div className="mobile-drawer-header">
            <h2>{t('deliverables.title')}</h2>
            <button className="mobile-drawer-close" onClick={closeDrawers}>
              ×
            </button>
          </div>
          <div className="mobile-drawer-section mobile-drawer-file-section">
            {activeProjectId ? (
              <FileSection
                baseUrl={`/api/projects/${activeProjectId}`}
                authToken={authToken}
                onFileClick={handleDelivFileClick}
                initialPath={delivPath}
                refreshKey={delivRefreshKey}
                showDownloadAll
              />
            ) : (
              <p className="mobile-drawer-placeholder">{t('deliverables.noProject')}</p>
            )}
          </div>
        </div>
      </MobileDrawer>

      {/* Notebook content */}
      <main className="mobile-content mobile-notebook-content" ref={contentRef}>
        <div className="mobile-cells">
          {/* Invisible sentinel for scroll-triggered lazy loading */}
          {cellsOffset > 0 && (
            <div ref={sentinelRef} className="notebook-load-more-sentinel">
              {loadingOlderCells && <div className="nb-delete-spinner" style={{ width: 16, height: 16 }} />}
            </div>
          )}
          {cells.map((cell, index) => (
            <Cell
              key={cell.id}
              cell={cell}
              index={cellsOffset + index}
            />
          ))}
          <div ref={bottomRef} />
        </div>
        {/* Scroll-to-bottom floating button (same as desktop) */}
        {showScrollBtn && (
          <button
            className="mobile-scroll-to-bottom"
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
            aria-label={t('notebook.scrollToBottom')}
          >
            ↓
          </button>
        )}
      </main>

      {/* Input bar */}
      <MobileInputBar />

      {/* Bottom sheets */}
      <MobileModelSheet />
      <MobilePluginSheet />
    </div>
  );
}
