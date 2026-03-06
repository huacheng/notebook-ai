import { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '../../store';
import { useT } from '../../i18n';
import { MobileHeader } from './MobileHeader';
import { MobileDrawer } from './MobileDrawer';
import { MobileInputBar } from './MobileInputBar';
import { MobilePromptQueue } from './MobilePromptQueue';
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
import { openNotebookByPath } from '../../utils/openNotebookByPath';

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
  const promptQueue = useStore((s) => s.promptQueue);
  const editMode = useStore((s) => s.editMode);
  const pendingDeletes = useStore((s) => s.pendingDeletes);
  const togglePendingDelete = useStore((s) => s.togglePendingDelete);
  const cells = notebook?.cells ?? [];
  const hasQueuedPrompts = promptQueue.length > 0;

  // File section state (same as desktop for consistency)
  const activeProjectId = useStore((s) => s.activeProjectId);
  const activeProjectPath = useStore((s) => s.activeProjectPath);
  const workspaceDir = useStore((s) => s.workspaceDir);
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

  // Open a .notebook.json as a notebook tab (shared utility — D5-1)
  const openAsNotebook = useCallback(async (subPath: string, name: string) => {
    if (!activeProjectPath) return;
    const notebookPath = subPath === '.' ? `${activeProjectPath}/${name}` : `${activeProjectPath}/${subPath}/${name}`;
    closeDrawers();
    await openNotebookByPath(notebookPath);
  }, [activeProjectPath, closeDrawers]);

  // File click handlers
  const handleWorkspaceFileClick = (subPath: string, name: string) => {
    if (name.endsWith('.notebook.json')) {
      openAsNotebook(subPath, name);
      return;
    }
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
    if (name.endsWith('.notebook.json')) {
      openAsNotebook(subPath, name);
      return;
    }
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
        <MobileHeader title="Notebook" showBack onBack={handleBack} showLangToggle={false} />
        <main className="mobile-content">
          <div className="mobile-loading">Loading notebook...</div>
        </main>
      </div>
    );
  }

  // Get notebook title from metadata or first cell
  const title = notebook.metadata?.title || 'Notebook';

  return (
    <div className={`mobile-view mobile-notebook-view${hasQueuedPrompts ? ' has-queue' : ''}`}>
      <MobileHeader
        title={title}
        showBack
        onBack={handleBack}
        showLeftMenu
        showRightMenu
        showLangToggle={false}
        rightContent={<MobileNotebookActions />}
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
                noDeleteFilter={(name, subPath) => name === '.MEMORY.md' || name === '.status.json' || name === '.working' || name === '.claude' || subPath?.startsWith('.claude/')}
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
      <main className={`mobile-content mobile-notebook-content${hasQueuedPrompts ? ' has-queue' : ''}`} ref={contentRef}>
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
              editMode={editMode}
              pendingDelete={pendingDeletes.has(cell.id)}
              onToggleDelete={togglePendingDelete}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </main>

      {/* Scroll-to-bottom floating button - outside scrollable container for stable fixed positioning */}
      {showScrollBtn && (
        <button
          className="mobile-scroll-to-bottom"
          onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
          aria-label={t('notebook.scrollToBottom')}
        >
          ↓
        </button>
      )}

      {/* Prompt queue */}
      <MobilePromptQueue />

      {/* Input bar */}
      <MobileInputBar />

      {/* Bottom sheets */}
      <MobileModelSheet />
      <MobilePluginSheet />

      {/* Restart overlay */}
      <MobileRestartOverlay />
    </div>
  );
}

/** Restart overlay for mobile - freezes page during restart */
function MobileRestartOverlay() {
  const t = useT();
  const restartPhase = useStore((s) => s.restartPhase);
  const restartError = useStore((s) => s.restartError);

  if (restartPhase === 'idle') return null;

  return (
    <div className="annotation-modal-overlay">
      <div className="annotation-modal" onClick={(e) => e.stopPropagation()}>
        {restartPhase === 'restarting' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div className="nb-delete-spinner" />
            <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--space-md)' }}>
              {t('overlay.restarting')}
            </p>
          </div>
        )}
        {restartPhase === 'done' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div style={{ fontSize: '28px', marginBottom: 'var(--space-sm)', color: 'var(--color-completed)' }}>&#10003;</div>
            <p style={{ color: 'var(--color-completed)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
              {t('overlay.restarted')}
            </p>
          </div>
        )}
        {restartPhase === 'error' && (
          <div style={{ textAlign: 'center', padding: 'var(--space-xl) 0' }}>
            <div style={{ fontSize: '28px', marginBottom: 'var(--space-sm)', color: 'var(--color-error)' }}>&#10007;</div>
            <p style={{ color: 'var(--color-error)', fontSize: 'var(--font-size-sm)', fontWeight: 500, marginBottom: 'var(--space-md)' }}>
              {t('overlay.restartFailed', restartError)}
            </p>
            <button
              className="notebook-statusbar-btn"
              onClick={() => useStore.getState().restartSession()}
              style={{ marginRight: 'var(--space-sm)' }}
            >
              {t('overlay.retry')}
            </button>
            <button
              className="notebook-statusbar-btn"
              onClick={() => useStore.setState({ restartPhase: 'idle', restartError: '' })}
            >
              {t('overlay.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
