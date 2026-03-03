import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
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
import { RegisterPage } from './components/RegisterPage';
import { PluginManager } from './components/PluginManager';
import { ModelManager } from './components/ModelManager';
import { MobileApp } from './components/mobile/MobileApp';
import { useWebSocket } from './hooks/useWebSocket';
import { useIsMobile } from './hooks/useIsMobile';
import { useNotification } from './hooks/useNotification';
import { useStore } from './store';
import { cacheSet, cacheGet, cacheRemove, TTL } from './utils/localCache';
import { I18nProvider, createT } from './i18n';
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
  const t = createT(useStore.getState().language);
  return (
    <div className="notebook-loading-screen">
      <div className="notebook-loading-bar" />
      <div className="notebook-loading-body">
        <div className="notebook-loading-spinner" />
        <p className="notebook-loading-text">{t('notebook.loadingNotebook')}</p>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const language = useStore((s) => s.language);
  const t = useMemo(() => createT(language), [language]);
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

  const rightPanelWidth = useStore((s) => s.rightPanelWidth);
  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const setRightPanelWidth = useStore((s) => s.setRightPanelWidth);
  const lastCompletedCellId = useStore((s) => s.lastCompletedCellId);

  // Notification system
  const { notify, requestPermission, stopTitleBlink, preloadSound } = useNotification();
  const lastNotifyTimeRef = useRef(0);
  const NOTIFY_DEBOUNCE_MS = 5000; // 5s debounce to avoid notification spam

  // Request notification permission and preload audio on first user interaction
  useEffect(() => {
    const handleInteraction = () => {
      requestPermission();
      preloadSound(); // D4-1 fix: preload audio to avoid first notification delay
      document.removeEventListener('click', handleInteraction);
    };
    document.addEventListener('click', handleInteraction);
    return () => document.removeEventListener('click', handleInteraction);
  }, [requestPermission, preloadSound]);

  // Notify when cell execution completes (only if tab is hidden, with debounce)
  useEffect(() => {
    if (lastCompletedCellId && document.hidden) {
      const now = Date.now();
      // D1-2 fix: debounce notifications to avoid spam on rapid completions
      if (now - lastNotifyTimeRef.current > NOTIFY_DEBOUNCE_MS) {
        notify(t('notification.taskComplete'), t('notification.claudeFinished'));
        lastNotifyTimeRef.current = now;
      }
    }
  }, [lastCompletedCellId, notify, t]);

  // Stop title blink when tab becomes visible
  useEffect(() => {
    const handleVisible = () => {
      if (!document.hidden) stopTitleBlink();
    };
    document.addEventListener('visibilitychange', handleVisible);
    return () => document.removeEventListener('visibilitychange', handleVisible);
  }, [stopTitleBlink]);

  const contentRef = useRef<HTMLElement | null>(null);
  const savedScrollRef = useRef<number>(0);
  const draggingRef = useRef<'left' | 'right' | 'split' | null>(null);
  const notebookSplitRef = useRef<HTMLDivElement | null>(null);
  const [splitRatio, setSplitRatio] = useState(0.5);

  // Saved right panel width for split-view restore
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

  // ── Auto-collapse right panel on split-view transition ────────────────────
  // Left sidebar keeps its width; right panel fully collapses to 24px.
  const prevSplitRef = useRef(false);
  useEffect(() => {
    if (inSplitView && !prevSplitRef.current) {
      // Entering split view — save right panel width and collapse it
      savedRightRef.current = rightPanelWidth;
      setRightPanelWidth(24); // fully collapsed
    } else if (!inSplitView && prevSplitRef.current) {
      // Exiting split view — restore right panel width
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
    <I18nProvider value={t}>
    <div className="app">
      {modelSwitching && (
        <div className="model-switch-overlay">
          <div className="model-switch-overlay-content">
            <span className="spinner" aria-hidden="true" />
            <span>{t('app.switchingModel')}</span>
          </div>
        </div>
      )}
      <Toolbar />
      {wsReconnectExhausted && wsStatus === 'disconnected' && (
        <div className="ws-exhausted-banner">
          {t('app.wsExhausted')}
          <button
            className="ws-exhausted-reload"
            onClick={() => window.location.reload()}
          >
            {t('app.refresh')}
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
              {t('app.missingMarkets')}
            </span>
            <button className="plugin-banner-install" onClick={openPluginPanel}>
              {t('app.managePlugins')}
            </button>
            <button
              className="plugin-banner-close"
              onClick={dismissPluginBanner}
              aria-label={t('app.closeBanner')}
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
                            {t('app.gitActive')}
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
    </I18nProvider>
  );
}

export default function App() {
  const language = useStore((s) => s.language);
  const t = useMemo(() => createT(language), [language]);
  const authRequired = useStore((s) => s.authRequired);
  const authToken = useStore((s) => s.authToken);
  const authError = useStore((s) => s.authError);
  const authLoading = useStore((s) => s.authLoading);
  const authVerifying = useStore((s) => s.authVerifying);
  const checkAuthStatus = useStore((s) => s.checkAuthStatus);
  const login = useStore((s) => s.login);
  const [showRegister, setShowRegister] = useState(false);

  const isMobile = useIsMobile();

  // Check if auth is required on mount
  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  // Still checking auth status or verifying token
  if (authRequired === null || authVerifying) {
    return (
      <I18nProvider value={t}>
        <div className="app-loading">
          <div className="login-logo">NB</div>
          <p>{t('login.loading')}</p>
        </div>
      </I18nProvider>
    );
  }

  // Auth required but no token — show login or register page
  if (authRequired && !authToken) {
    return (
      <I18nProvider value={t}>
        {showRegister ? (
          <RegisterPage onBack={() => setShowRegister(false)} />
        ) : (
          <LoginPage
            onLogin={login}
            error={authError}
            loading={authLoading}
            onRegister={() => setShowRegister(true)}
          />
        )}
      </I18nProvider>
    );
  }

  // Mobile layout
  if (isMobile) {
    return (
      <I18nProvider value={t}>
        <MobileApp />
      </I18nProvider>
    );
  }

  // Desktop layout
  return <AuthenticatedApp />;
}
