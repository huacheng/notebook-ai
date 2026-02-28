import { useEffect, useRef, useCallback, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { Notebook } from './components/Notebook';
import { ProjectSidebar } from './components/ProjectSidebar';
import { NotebookTabs } from './components/NotebookTabs';
import { RightPanel } from './components/RightPanel';
import { FileViewer } from './components/FileViewer';
import { WelcomeScreen } from './components/WelcomeScreen';
import { NotebookCreationPanel } from './components/NotebookCreationPanel';
import { GitHistoryPanel } from './components/GitHistoryPanel';
import { LoginPage } from './components/LoginPage';
import { PluginManager } from './components/PluginManager';
import { ModelManager } from './components/ModelManager';
import { useWebSocket } from './hooks/useWebSocket';
import { useStore } from './store';
import { cacheSet, cacheGet, cacheRemove, TTL } from './utils/localCache';
import { computeSplitEntryWidth } from './utils/splitView';
import './styles.css';

// ── Scroll position persistence ─────────────────────────────────────────────

/**
 * Saves and restores the scroll position of a container element,
 * keyed by notebookId in localStorage.
 * Also re-applies the saved position when the browser tab becomes visible again.
 */
function useScrollRestoration(
  notebookId: string | null,
  containerRef: React.RefObject<HTMLElement | null>,
) {
  // Restore saved position when notebook changes (switch between notebooks).
  useEffect(() => {
    if (!notebookId || !containerRef.current) return;
    // Slight delay to let React finish rendering cells before scrolling.
    const id = requestAnimationFrame(() => {
      const saved = cacheGet<number>(`nb-scroll-${notebookId}`, TTL.SCROLL);
      if (saved !== null && containerRef.current) {
        containerRef.current.scrollTop = saved;
      }
    });
    return () => cancelAnimationFrame(id);
  }, [notebookId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist scroll position on user scroll (debounced at 200 ms).
  useEffect(() => {
    if (!notebookId || !containerRef.current) return;
    const el = containerRef.current;
    let timer = 0;

    function onScroll() {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        cacheSet(`nb-scroll-${notebookId}`, el.scrollTop);
      }, 200);
    }

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      clearTimeout(timer);
    };
  }, [notebookId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-apply saved position when the user switches back to this browser tab.
  useEffect(() => {
    if (!notebookId) return;

    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && containerRef.current) {
        const saved = cacheGet<number>(`nb-scroll-${notebookId}`, TTL.SCROLL);
        if (saved !== null) {
          containerRef.current.scrollTop = saved;
        }
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [notebookId]); // eslint-disable-line react-hooks/exhaustive-deps
}

function NotebookLoadingScreen() {
  return (
    <div className="notebook-loading-screen">
      <div className="notebook-loading-bar" />
      <div className="notebook-loading-body">
        <div className="notebook-loading-spinner" />
        <p className="notebook-loading-text">Loading notebook…</p>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const notebook = useStore((s) => s.notebook);
  const notebookLoading = useStore((s) => s.notebookLoading);
  const activeNotebookId = useStore((s) => s.activeNotebookId);
  const creatingNotebook = useStore((s) => s.creatingNotebook);
  const restoreNotebook = useStore((s) => s.restoreNotebook);
  const wsStatus = useStore((s) => s.wsStatus);
  const wsReconnectExhausted = useStore((s) => s.wsReconnectExhausted);
  const sessionId = useStore((s) => s.sessionId);
  const fetchProjects = useStore((s) => s.fetchProjects);
  const gitTabOpen = useStore((s) => s.gitTabOpen);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const activeFileTabId = useStore((s) => s.activeFileTabId);
  const fileViewerMaximized = useStore((s) => s.fileViewerMaximized);
  const pluginStatus = useStore((s) => s.pluginStatus);
  const pluginDismissed = useStore((s) => s.pluginDismissed);
  const pluginPanelOpen = useStore((s) => s.pluginPanelOpen);
  const modelPanelOpen = useStore((s) => s.modelPanelOpen);
  const modelSwitching = useStore((s) => s.modelSwitching);
  const checkPluginStatus = useStore((s) => s.checkPluginStatus);
  const openPluginPanel = useStore((s) => s.openPluginPanel);
  const dismissPluginBanner = useStore((s) => s.dismissPluginBanner);

  const sidebarWidth = useStore((s) => s.sidebarWidth);
  const rightPanelWidth = useStore((s) => s.rightPanelWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const setRightPanelWidth = useStore((s) => s.setRightPanelWidth);

  const contentRef = useRef<HTMLElement | null>(null);
  const savedScrollRef = useRef<number>(0);
  const draggingRef = useRef<'left' | 'right' | 'split' | null>(null);
  const notebookSplitRef = useRef<HTMLDivElement | null>(null);
  const [splitRatio, setSplitRatio] = useState(0.5);

  // Saved panel widths for split-view restore
  const savedSidebarRef = useRef<number | null>(null);
  const savedRightRef = useRef<number | null>(null);

  // ── Column divider drag ──────────────────────────────────────────────
  const startLeftDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = 'left';
  }, []);

  const startRightDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = 'right';
  }, []);

  const startSplitDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = 'split';
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      if (draggingRef.current === 'left') {
        setSidebarWidth(e.clientX);
      } else if (draggingRef.current === 'right') {
        setRightPanelWidth(window.innerWidth - e.clientX);
      } else if (draggingRef.current === 'split' && contentRef.current) {
        const rect = contentRef.current.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        setSplitRatio(Math.min(0.8, Math.max(0.2, ratio)));
      }
    };
    const onUp = () => { draggingRef.current = null; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [setSidebarWidth, setRightPanelWidth]);

  // Initiate WebSocket connection only when we have a sessionId.
  useWebSocket(sessionId);

  const hasActiveFile = activeFileTabId !== null;
  const hasNotebook = notebook !== null;
  const inSplitView = hasActiveFile && hasNotebook
    && !pluginPanelOpen && !modelPanelOpen && !fileViewerMaximized;

  // ── Auto-shrink panels on split-view transition ────────────────────
  const prevSplitRef = useRef(false);
  useEffect(() => {
    if (inSplitView && !prevSplitRef.current) {
      // Entering split view — save widths and shrink
      savedSidebarRef.current = sidebarWidth;
      savedRightRef.current = rightPanelWidth;
      setSidebarWidth(computeSplitEntryWidth(sidebarWidth));
      setRightPanelWidth(computeSplitEntryWidth(rightPanelWidth));
    } else if (!inSplitView && prevSplitRef.current) {
      // Exiting split view — restore saved widths
      if (savedSidebarRef.current !== null) {
        setSidebarWidth(savedSidebarRef.current);
        savedSidebarRef.current = null;
      }
      if (savedRightRef.current !== null) {
        setRightPanelWidth(savedRightRef.current);
        savedRightRef.current = null;
      }
    }
    prevSplitRef.current = inSplitView;
  }); // intentionally no deps — runs every render but only acts on transitions

  // Persist and restore scroll position across notebook switches and browser tab switches.
  const activeNotebookTabId = useStore((s) => s.activeNotebookTabId);
  useScrollRestoration(activeNotebookTabId ?? activeNotebookId, inSplitView ? notebookSplitRef : contentRef);

  // Fetch projects on mount
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Check plugin status on mount
  useEffect(() => {
    checkPluginStatus();
  }, [checkPluginStatus]);

  // Save last opened notebook ID to localStorage.
  useEffect(() => {
    if (activeNotebookId) {
      cacheSet('nb-last-notebook', activeNotebookId);
    }
  }, [activeNotebookId]);

  // On mount: reopen the last notebook if none is currently active.
  useEffect(() => {
    const lastId = cacheGet<string>('nb-last-notebook', TTL.LAST_NOTEBOOK);
    if (lastId) {
      restoreNotebook(lastId).catch(() => {
        cacheRemove('nb-last-notebook');
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save/restore scroll position when FileViewer opens/closes (R1).
  // Only needed when notebook is NOT mounted (no split view — notebook disappears entirely).
  const prevHasFileRef = useRef(hasActiveFile);
  useEffect(() => {
    const wasOpen = prevHasFileRef.current;
    const isOpen = hasActiveFile;
    prevHasFileRef.current = hasActiveFile;

    if (!hasNotebook) {
      if (!wasOpen && isOpen && contentRef.current) {
        savedScrollRef.current = contentRef.current.scrollTop;
      } else if (wasOpen && !isOpen && contentRef.current) {
        requestAnimationFrame(() => {
          if (contentRef.current) {
            contentRef.current.scrollTop = savedScrollRef.current;
          }
        });
      }
    }
  }, [hasActiveFile, hasNotebook]);

  return (
    <div className="app">
      {modelSwitching && (
        <div className="model-switch-overlay">
          <div className="model-switch-overlay-content">
            <span className="spinner" aria-hidden="true" />
            <span>Switching model…</span>
          </div>
        </div>
      )}
      <Toolbar />
      {wsReconnectExhausted && wsStatus === 'disconnected' && (
        <div className="ws-exhausted-banner">
          连接已断开，请刷新页面重试。
          <button
            className="ws-exhausted-reload"
            onClick={() => window.location.reload()}
          >
            刷新
          </button>
        </div>
      )}
      {pluginStatus && !pluginDismissed && (() => {
        const TARGET_MARKETPLACES = ['anthropic-agent-skills', 'claude-code-plugins', 'claude-plugins-official', 'moonview'];
        const existingNames = new Set(pluginStatus.marketplaces.map(m => m.name));
        const missing = TARGET_MARKETPLACES.filter(n => !existingNames.has(n));
        if (missing.length === 0) return null;
        return (
          <div className="plugin-banner">
            <span className="plugin-banner-text">
              部分插件市场未添加，点击管理进行配置。
            </span>
            <button className="plugin-banner-install" onClick={openPluginPanel}>
              管理插件
            </button>
            <button
              className="plugin-banner-close"
              onClick={dismissPluginBanner}
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        );
      })()}
      <div className={`app-body${hasActiveFile && fileViewerMaximized ? ' app-body--fv-maximized' : ''}`}>
        <ProjectSidebar />
        <div className="app-divider" onMouseDown={startLeftDrag} />
        <main ref={contentRef} className={`app-content${inSplitView ? ' app-content--split' : ''}`}>
          <NotebookTabs inSplitView={inSplitView} splitRatio={splitRatio} />
          <div
            className={`notebook-area${inSplitView ? ' notebook-area--split' : ''}`}
            style={inSplitView ? { '--split-ratio': splitRatio } as React.CSSProperties : undefined}
          >
            {pluginPanelOpen ? (
              <PluginManager />
            ) : modelPanelOpen ? (
              <ModelManager />
            ) : hasActiveFile ? (
              <>
                <FileViewer />
                {inSplitView && (
                  <>
                    <div className="split-divider" onMouseDown={startSplitDrag} />
                    <div className="notebook-split-pane" ref={notebookSplitRef}>
                      {gitTabOpen ? (
                        <div className="split-notebook-overlay">
                          <div className="split-notebook-overlay-icon">&#9881;</div>
                          <p className="split-notebook-overlay-text">
                            Git History is active. Switch to a notebook tab to continue
                          </p>
                        </div>
                      ) : (
                        <Notebook />
                      )}
                    </div>
                  </>
                )}
              </>
            ) : gitTabOpen && activeProjectId ? (
              null  /* GitHistoryPanel rendered below as keep-alive */
            ) : notebookLoading ? (
              <NotebookLoadingScreen />
            ) : creatingNotebook ? (
              <NotebookCreationPanel />
            ) : hasNotebook ? (
              <Notebook />
            ) : (
              <WelcomeScreen />
            )}
            {/* Keep-alive: GitHistoryPanel stays mounted once activated, hidden via CSS */}
            {activeProjectId && (
              <div style={{ display: gitTabOpen && !pluginPanelOpen && !modelPanelOpen && !hasActiveFile ? undefined : 'none' }}>
                <GitHistoryPanel projectId={activeProjectId} />
              </div>
            )}
          </div>
        </main>
        <div className="app-divider" onMouseDown={startRightDrag} />
        <RightPanel />
      </div>
    </div>
  );
}

export default function App() {
  const authRequired = useStore((s) => s.authRequired);
  const authToken = useStore((s) => s.authToken);
  const authError = useStore((s) => s.authError);
  const authLoading = useStore((s) => s.authLoading);
  const checkAuthStatus = useStore((s) => s.checkAuthStatus);
  const login = useStore((s) => s.login);

  // Check if auth is required on mount
  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  // Still checking auth status
  if (authRequired === null) {
    return (
      <div className="app-loading">
        <div className="login-logo">NB</div>
        <p>Loading...</p>
      </div>
    );
  }

  // Auth required but no token
  if (authRequired && !authToken) {
    return (
      <LoginPage
        onLogin={login}
        error={authError}
        loading={authLoading}
      />
    );
  }

  return <AuthenticatedApp />;
}
