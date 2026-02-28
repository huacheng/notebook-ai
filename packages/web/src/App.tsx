import { useEffect, useRef, useCallback } from 'react';
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
  const rightPanelOpen = useStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useStore((s) => s.setRightPanelOpen);

  const pluginStatus = useStore((s) => s.pluginStatus);
  const pluginDismissed = useStore((s) => s.pluginDismissed);
  const pluginPanelOpen = useStore((s) => s.pluginPanelOpen);
  const modelPanelOpen = useStore((s) => s.modelPanelOpen);
  const modelSwitching = useStore((s) => s.modelSwitching);
  const checkPluginStatus = useStore((s) => s.checkPluginStatus);
  const openPluginPanel = useStore((s) => s.openPluginPanel);
  const dismissPluginBanner = useStore((s) => s.dismissPluginBanner);

  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const setRightPanelWidth = useStore((s) => s.setRightPanelWidth);

  const contentRef = useRef<HTMLElement | null>(null);
  const savedScrollRef = useRef<number>(0);
  const draggingRef = useRef<'left' | 'right' | null>(null);

  // ── Column divider drag ──────────────────────────────────────────────
  const startLeftDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = 'left';
  }, []);

  const startRightDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = 'right';
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      if (draggingRef.current === 'left') {
        setSidebarWidth(e.clientX);
      } else {
        setRightPanelWidth(window.innerWidth - e.clientX);
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

  // Persist and restore scroll position across notebook switches and browser tab switches.
  const activeNotebookTabId = useStore((s) => s.activeNotebookTabId);
  useScrollRestoration(activeNotebookTabId ?? activeNotebookId, contentRef);

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
  const hasActiveFile = activeFileTabId !== null;
  const prevHasFileRef = useRef(hasActiveFile);
  useEffect(() => {
    const wasOpen = prevHasFileRef.current;
    const isOpen = hasActiveFile;
    prevHasFileRef.current = hasActiveFile;

    if (!wasOpen && isOpen && contentRef.current) {
      // FileViewer opening — save current scroll position.
      savedScrollRef.current = contentRef.current.scrollTop;
    } else if (wasOpen && !isOpen && contentRef.current) {
      // FileViewer closing — restore saved scroll position.
      requestAnimationFrame(() => {
        if (contentRef.current) {
          contentRef.current.scrollTop = savedScrollRef.current;
        }
      });
    }
  }, [hasActiveFile]);

  // Auto-collapse RightPanel when FileViewer opens; restore when it closes.
  const savedRightPanelRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (hasActiveFile && rightPanelOpen) {
      savedRightPanelRef.current = true;
      setRightPanelOpen(false);
    } else if (!hasActiveFile && savedRightPanelRef.current) {
      setRightPanelOpen(true);
      savedRightPanelRef.current = null;
    }
  }, [hasActiveFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasNotebook = notebook !== null;

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
        <main ref={contentRef} className="app-content">
          <NotebookTabs />
          <div className="notebook-area">
            {pluginPanelOpen ? (
              <PluginManager />
            ) : modelPanelOpen ? (
              <ModelManager />
            ) : hasActiveFile ? (
              <FileViewer />
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
