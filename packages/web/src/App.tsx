import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Toolbar } from './components/Toolbar';
import { Notebook } from './components/Notebook';
import { ProjectSidebar } from './components/ProjectSidebar';
import { NotebookTabs } from './components/NotebookTabs';
import { FileViewer } from './components/FileViewer';
import { WelcomeScreen } from './components/WelcomeScreen';
import { NotebookCreationPanel } from './components/NotebookCreationPanel';
import { GitHistoryPanel } from './components/GitHistoryPanel';
import { LoginPage } from './components/LoginPage';
import { TokenLoginPage } from './components/TokenLoginPage';
import { RegisterPage } from './components/RegisterPage';
import { PreflightBanner } from './components/PreflightBanner';
import { PluginManager } from './components/PluginManager';
import { ModelManager } from './components/ModelManager';
import { LoginPanel } from './components/LoginPanel';
import { MobileApp } from './components/mobile/MobileApp';
import { useWebSocket } from './hooks/useWebSocket';
import { useIsMobile } from './hooks/useIsMobile';
import { useNotification, NOTIFY_DEBOUNCE_MS } from './hooks/useNotification';
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
  // activeFileTabId no longer needed — FileViewer always rendered
  const pluginStatus = useStore((s) => s.pluginStatus);
  const pluginDismissed = useStore((s) => s.pluginDismissed);
  const pluginPanelOpen = useStore((s) => s.pluginPanelOpen);
  const modelPanelOpen = useStore((s) => s.modelPanelOpen);
  const modelSwitching = useStore((s) => s.modelSwitching);
  const loginPanelOpen = useStore((s) => s.loginPanelOpen);
  const checkPluginStatus = useStore((s) => s.checkPluginStatus);
  const openPluginPanel = useStore((s) => s.openPluginPanel);
  const dismissPluginBanner = useStore((s) => s.dismissPluginBanner);

  const setSidebarWidth = useStore((s) => s.setSidebarWidth);
  const lastCompletedCellId = useStore((s) => s.lastCompletedCellId);
  const lastAskQuestionCellId = useStore((s) => s.lastAskQuestionCellId);

  // Notification system
  const { notify, requestPermission, preloadSound } = useNotification();
  const lastNotifyTimeRef = useRef(0);

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

  // Notify when AskUserQuestion requires user input (only if tab is hidden, with debounce)
  useEffect(() => {
    if (lastAskQuestionCellId && document.hidden) {
      const now = Date.now();
      if (now - lastNotifyTimeRef.current > NOTIFY_DEBOUNCE_MS) {
        notify(t('notification.inputRequired'), t('notification.claudeNeedsInput'));
        lastNotifyTimeRef.current = now;
      }
    }
  }, [lastAskQuestionCellId, notify, t]);

  // D3-3 fix: Removed duplicate visibilitychange listener - notify() handles this internally

  const contentRef = useRef<HTMLElement | null>(null);
  const draggingRef = useRef<'left' | 'split' | null>(null);
  const notebookSplitRef = useRef<HTMLDivElement | null>(null);
  const [splitRatio, setSplitRatio] = useState(0.45);

  // ── Column divider drag ──────────────────────────────────────────────
  const startLeftDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = 'left';
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
  }, [setSidebarWidth]);

  // Initiate WebSocket connection only when we have a sessionId.
  useWebSocket(sessionId);

  const hasNotebook = notebook !== null;

  // Persist and restore scroll position across notebook switches and browser tab switches.
  const activeNotebookTabId = useStore((s) => s.activeNotebookTabId);
  useScrollRestoration(activeNotebookTabId ?? activeNotebookId, notebookSplitRef);

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

  // On mount: restore active project, open tabs, and last notebook from localStorage.
  useEffect(() => {
    // Restore active project context (sidebar L2 state)
    try {
      const saved = localStorage.getItem('nb-active-project');
      if (saved) {
        const { id, path } = JSON.parse(saved);
        if (id && path) {
          useStore.getState().setActiveProject(id, path);
        }
      }
    } catch { /* ignore corrupt data */ }

    // Restore non-active notebook tabs and file tabs from cache
    useStore.getState().restoreOpenNotebookTabs();
    useStore.getState().restoreOpenFileTabs();

    const lastId = cacheGet<string>('nb-last-notebook', TTL.LAST_NOTEBOOK);
    if (lastId) {
      restoreNotebook(lastId).catch(() => {
        cacheRemove('nb-last-notebook');
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


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
      {!wsReconnectExhausted && wsStatus !== 'connected' && (
        <div className={`ws-reconnect-banner ${wsStatus}`}>
          {wsStatus === 'connecting' && <span className="ws-reconnect-spinner" />}
          <span>{wsStatus === 'connecting' ? t('app.connecting') : t('app.reconnecting')}</span>
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
      <PreflightBanner />
      <div className="app-body">
        <ProjectSidebar />
        <div className="app-divider" onMouseDown={startLeftDrag} />
        <main ref={contentRef} className="app-content app-content--split">
          <NotebookTabs inSplitView splitRatio={splitRatio} />
          <div
            className="notebook-area notebook-area--split"
            style={{ '--split-ratio': splitRatio } as React.CSSProperties}
          >
            {/* Left pane: FileViewer (always visible) */}
            <FileViewer />
            <div className="split-divider" onMouseDown={startSplitDrag} />
            {/* Right pane: Notebook / panels */}
            <div className="notebook-split-pane" ref={notebookSplitRef}>
              {pluginPanelOpen ? (
                <PluginManager />
              ) : modelPanelOpen ? (
                <ModelManager />
              ) : loginPanelOpen ? (
                <LoginPanel />
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
                <div style={{ display: gitTabOpen && !pluginPanelOpen && !modelPanelOpen ? undefined : 'none' }}>
                  <GitHistoryPanel projectId={activeProjectId} />
                </div>
              )}
            </div>
          </div>
        </main>
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
  const authMode = useStore((s) => s.authMode);
  const authError = useStore((s) => s.authError);
  const authLoading = useStore((s) => s.authLoading);
  const authVerifying = useStore((s) => s.authVerifying);
  const checkAuthStatus = useStore((s) => s.checkAuthStatus);
  const login = useStore((s) => s.login);
  const loginWithToken = useStore((s) => s.loginWithToken);
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

  // Auth required but no token — show login page based on authMode
  if (authRequired && !authToken) {
    return (
      <I18nProvider value={t}>
        {authMode === 'token' ? (
          <TokenLoginPage
            onLogin={loginWithToken}
            error={authError}
            loading={authLoading}
          />
        ) : showRegister ? (
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
