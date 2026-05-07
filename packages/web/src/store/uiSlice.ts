import { cacheSet, cacheGet, TTL } from '../utils/localCache';
import type { StateCreator } from 'zustand';
import type { NotebookStore } from './types';
import {
  fetchPluginStatus,
  installPlugin as apiInstallPlugin,
  uninstallPlugin as apiUninstallPlugin,
  addMarketplace as apiAddMarketplace,
  removeMarketplace as apiRemoveMarketplace,
  updateMarketplace as apiUpdateMarketplace,
  updatePlugin as apiUpdatePlugin,
} from '../api/plugin';

/** Persist open file tab references + active tab to localStorage */
function _persistFileTabs(
  openFiles: Record<string, { path: string; source: string; projectId?: string }>,
  activeId: string | null,
) {
  try {
    const tabs = Object.entries(openFiles).map(([tabId, f]) => ({
      tabId,
      path: f.path,
      source: f.source,
      ...(f.projectId ? { projectId: f.projectId } : {}),
    }));
    cacheSet('nb-open-files', { tabs, activeId }, TTL.LAST_NOTEBOOK);
  } catch { /* localStorage unavailable in test/SSR */ }
}

function restartAllNotebooks(get: () => NotebookStore) {
  const { ws, openNotebooks } = get();
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  for (const [, { sessionId }] of Object.entries(openNotebooks)) {
    if (sessionId) {
      ws.send(JSON.stringify({ type: 'restart_session', session_id: sessionId }));
    }
  }
}

export const createUiSlice: StateCreator<NotebookStore, [], [], Pick<NotebookStore,
  | 'activeTab' | 'gitTabOpen' | 'sessionNotice' | 'latency' | 'creatingNotebook'
  | 'wsReconnectExhausted'
  | 'setActiveTab' | 'openGitTab' | 'closeGitTab'
  | 'clearSessionNotice' | 'setLatency'
  | 'setWsReconnectExhausted'
  | 'openFiles' | 'activeFileTabId'
  | 'openFileTab' | 'closeFileTab' | 'setActiveFileTab' | 'deactivateFileTab' | 'closeAllFileTabs' | 'closeProjectFileTabs' | 'closeDeletedFileTabs' | 'setFileTabLoading' | 'restoreOpenFileTabs'
  | 'leftSidebarSplitRatio' | 'setLeftSidebarSplitRatio'
  | 'sidebarWidth'
  | 'setSidebarWidth'
  | 'editMode' | 'pendingDeletes' | 'editSavePhase' | 'editSaveError'
  | 'setEditMode' | 'togglePendingDelete' | 'commitEdits'
  | 'pluginStatus' | 'pluginLoading' | 'pluginActionKey' | 'pluginDismissed' | 'pluginPanelOpen' | 'pluginOverlay'
  | 'checkPluginStatus' | 'installPlugin' | 'uninstallPlugin' | 'addMarketplace' | 'removeMarketplace' | 'updateMarketplace' | 'updatePlugin'
  | 'dismissPluginBanner' | 'openPluginPanel' | 'closePluginPanel'
  | 'modelPanelOpen' | 'modelSwitching' | 'openModelPanel' | 'closeModelPanel' | 'changeModel'
  | 'loginPanelOpen' | 'loginPhase' | 'loginUrl' | 'loginError' | 'loginStatus'
  | 'openLoginPanel' | 'closeLoginPanel' | 'claudeLogin' | 'claudeLoginStartPolling' | 'claudeLoginSubmitCode' | 'claudeLoginCancel' | 'claudeLogout' | 'fetchClaudeStatus'
  | 'language' | 'setLanguage'
>> = (set, get) => ({
  activeTab: 'notebook',
  gitTabOpen: false,
  sessionNotice: null,
  latency: null,
  creatingNotebook: false,
  wsReconnectExhausted: false,
  leftSidebarSplitRatio: 0.5,
  openFiles: {},
  activeFileTabId: null,
  sidebarWidth: 240,
  editMode: false,
  pendingDeletes: new Set<string>(),
  editSavePhase: 'idle',
  editSaveError: '',
  pluginStatus: null,
  pluginLoading: false,
  pluginActionKey: null,
  pluginDismissed: false,
  pluginPanelOpen: false,
  pluginOverlay: null,
  modelPanelOpen: false,
  modelSwitching: false,
  loginPanelOpen: false,
  loginPhase: 'options' as const,
  loginUrl: null,
  loginError: null,
  loginStatus: null,
  language: (() => {
    if (typeof localStorage === 'undefined') return 'en';
    const stored = localStorage.getItem('nb-lang');
    if (stored === 'zh' || stored === 'en') return stored;
    // Default language from build-time env or fallback to 'en'
    const defaultLang = (import.meta as any).env?.VITE_DEFAULT_LANG;
    return defaultLang === 'zh' ? 'zh' : 'en';
  })(),

  setActiveTab(tab) {
    set({ activeTab: tab, gitTabOpen: tab === 'git', editMode: false, pendingDeletes: new Set<string>() });
  },

  openGitTab() {
    set({ activeTab: 'git', gitTabOpen: true });
  },

  closeGitTab() {
    set({ activeTab: 'notebook', gitTabOpen: false });
  },

  clearSessionNotice() {
    set({ sessionNotice: null });
  },

  setLatency(ms) {
    set({ latency: ms });
  },

  setWsReconnectExhausted(v) {
    set({ wsReconnectExhausted: v });
  },

  openFileTab(file) {
    // Generate tabId based on source type
    const tabId = file.source === 'project-git'
      ? `project-git::${file.projectId}`
      : file.source === 'library-git'
        ? 'library-git::library'
        : `${file.source}::${file.path}`;
    set(s => {
      const newFiles = { ...s.openFiles, [tabId]: { ...file, loading: true } };
      _persistFileTabs(newFiles, tabId);
      return { openFiles: newFiles, activeFileTabId: tabId };
    });
  },

  closeFileTab(tabId) {
    set(s => {
      const { [tabId]: _, ...rest } = s.openFiles;
      const ids = Object.keys(rest);
      const newActive = s.activeFileTabId === tabId
        ? (ids[0] ?? null)
        : s.activeFileTabId;
      _persistFileTabs(rest, newActive);
      return { openFiles: rest, activeFileTabId: newActive };
    });
  },

  setActiveFileTab(tabId) {
    set({ activeFileTabId: tabId });
  },

  deactivateFileTab() {
    set({ activeFileTabId: null });
  },

  closeAllFileTabs() {
    _persistFileTabs({}, null);
    set({ openFiles: {}, activeFileTabId: null });
  },

  closeProjectFileTabs(projectId, pathPrefix) {
    set(s => {
      const remaining: typeof s.openFiles = {};
      for (const [tabId, file] of Object.entries(s.openFiles)) {
        const match = file.projectId === projectId
          && (!pathPrefix || file.path.startsWith(pathPrefix));
        if (!match) remaining[tabId] = file;
      }
      const activeGone = s.activeFileTabId && !(s.activeFileTabId in remaining);
      const ids = Object.keys(remaining);
      const newActive = activeGone ? (ids[0] ?? null) : s.activeFileTabId;
      _persistFileTabs(remaining, newActive);
      return {
        openFiles: remaining,
        activeFileTabId: newActive,
      };
    });
  },

  closeDeletedFileTabs(deletedPaths: string[]) {
    set(s => {
      const remaining: typeof s.openFiles = {};
      for (const [tabId, file] of Object.entries(s.openFiles)) {
        const hit = deletedPaths.some((dp: string) =>
          file.path === dp || file.path.startsWith(dp + '/')
        );
        if (!hit) remaining[tabId] = file;
      }
      const activeGone = s.activeFileTabId && !(s.activeFileTabId in remaining);
      const ids = Object.keys(remaining);
      const newActive = activeGone ? (ids[0] ?? null) : s.activeFileTabId;
      _persistFileTabs(remaining, newActive);
      return {
        openFiles: remaining,
        activeFileTabId: newActive,
      };
    });
  },

  setFileTabLoading(tabId, loading) {
    set(s => {
      const entry = s.openFiles[tabId];
      if (!entry) return s;
      return { openFiles: { ...s.openFiles, [tabId]: { ...entry, loading } } };
    });
  },

  restoreOpenFileTabs() {
    const saved = cacheGet<{
      tabs: { tabId: string; path: string; source: 'workspace' | 'library' | 'deliverables' | 'project-git' | 'library-git'; projectId?: string }[];
      activeId: string | null;
    }>('nb-open-files', TTL.LAST_NOTEBOOK);
    if (!saved || saved.tabs.length === 0) return;
    const openFiles: Record<string, { path: string; source: 'workspace' | 'library' | 'deliverables' | 'project-git' | 'library-git'; sessionId: string; projectId?: string; loading?: boolean }> = {};
    for (const tab of saved.tabs) {
      openFiles[tab.tabId] = { path: tab.path, source: tab.source, sessionId: '', ...(tab.projectId ? { projectId: tab.projectId } : {}), loading: true };
    }
    set({ openFiles, activeFileTabId: saved.activeId });
  },

  setLeftSidebarSplitRatio(ratio) {
    set({ leftSidebarSplitRatio: Math.min(0.8, Math.max(0.2, ratio)) });
  },

  setSidebarWidth(px) {
    set({ sidebarWidth: Math.min(500, Math.max(120, px)) });
  },

  setEditMode(on) {
    if (on) {
      set({ editMode: true, pendingDeletes: new Set<string>(), editSaveError: '' });
    } else {
      set({ editMode: false, pendingDeletes: new Set<string>() });
    }
  },

  togglePendingDelete(cellId) {
    set((s) => {
      const next = new Set(s.pendingDeletes);
      if (next.has(cellId)) {
        next.delete(cellId);
      } else {
        next.add(cellId);
      }
      return { pendingDeletes: next };
    });
  },

  commitEdits() {
    set({ editSavePhase: 'saving' });
    const { ws, sessionId, pendingDeletes } = get();
    if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
      ws.send(JSON.stringify({
        type: 'remove_cells',
        session_id: sessionId,
        cell_ids: [...pendingDeletes],
      }));
    }
  },

  async checkPluginStatus() {
    set({ pluginLoading: true });
    try {
      const status = await fetchPluginStatus();
      set({ pluginStatus: status, pluginLoading: false });
    } catch {
      set({ pluginLoading: false });
    }
  },

  async installPlugin(key: string) {
    set({ pluginActionKey: key, pluginOverlay: `plugin.installing|${key.split('@')[0]}` });
    try {
      await apiInstallPlugin(key);
      // Restart all open notebooks to pick up plugin changes
      restartAllNotebooks(get);
      // Refresh plugin status
      const status = await fetchPluginStatus();
      set({ pluginStatus: status, pluginActionKey: null, pluginOverlay: null });
    } catch {
      set({ pluginActionKey: null, pluginOverlay: null });
    }
  },

  async uninstallPlugin(key: string) {
    set({ pluginActionKey: key, pluginOverlay: `plugin.uninstalling|${key.split('@')[0]}` });
    try {
      await apiUninstallPlugin(key);
      restartAllNotebooks(get);
      const status = await fetchPluginStatus();
      set({ pluginStatus: status, pluginActionKey: null, pluginOverlay: null });
    } catch {
      set({ pluginActionKey: null, pluginOverlay: null });
    }
  },

  async addMarketplace(source: string) {
    set({ pluginOverlay: `plugin.addingMarket|${source}` });
    try {
      await apiAddMarketplace(source);
      const status = await fetchPluginStatus();
      set({ pluginStatus: status, pluginOverlay: null });
    } catch {
      set({ pluginOverlay: null });
    }
  },

  async removeMarketplace(name: string) {
    set({ pluginOverlay: `plugin.removingMarket|${name}` });
    try {
      await apiRemoveMarketplace(name);
      const status = await fetchPluginStatus();
      set({ pluginStatus: status, pluginOverlay: null });
    } catch {
      set({ pluginOverlay: null });
    }
  },

  async updateMarketplace(name?: string) {
    set({ pluginOverlay: name ? `plugin.updatingMarket|${name}` : 'plugin.updatingAll' });
    try {
      await apiUpdateMarketplace(name);
      restartAllNotebooks(get);
      const status = await fetchPluginStatus();
      set({ pluginStatus: status, pluginOverlay: null });
    } catch {
      set({ pluginOverlay: null });
    }
  },

  async updatePlugin(key: string) {
    set({ pluginActionKey: key, pluginOverlay: `plugin.updatingPlugin|${key.split('@')[0]}` });
    try {
      const result = await apiUpdatePlugin(key);
      const stepsLog = result.steps?.join('\n') ?? '';
      if (result.ok) {
        restartAllNotebooks(get);
        const status = await fetchPluginStatus();
        set({
          pluginStatus: status,
          pluginActionKey: null,
          pluginOverlay: null,
          sessionNotice: `Plugin update ${key}:\n${stepsLog}`,
        });
      } else {
        set({
          pluginActionKey: null,
          pluginOverlay: null,
          sessionNotice: `Plugin update failed (${key}):\n${stepsLog}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ pluginActionKey: null, pluginOverlay: null, sessionNotice: `Plugin update error: ${msg}` });
    }
  },

  dismissPluginBanner() {
    set({ pluginDismissed: true });
  },

  openPluginPanel() {
    set({ pluginPanelOpen: true, modelPanelOpen: false });
  },

  closePluginPanel() {
    set({ pluginPanelOpen: false });
  },

  openModelPanel() {
    set({ modelPanelOpen: true, pluginPanelOpen: false });
  },

  closeModelPanel() {
    set({ modelPanelOpen: false });
  },

  changeModel(model: string) {
    const { ws, openNotebooks, activeNotebookTabId } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!activeNotebookTabId) return;
    const active = openNotebooks[activeNotebookTabId];
    if (active?.sessionId) {
      set({ modelSwitching: true, modelPanelOpen: false });
      ws.send(JSON.stringify({ type: 'change_model', session_id: active.sessionId, model }));
    }
  },

  openLoginPanel() {
    set({ loginPanelOpen: true, loginPhase: 'options', loginUrl: null, loginError: null, pluginPanelOpen: false, modelPanelOpen: false });
    // Fetch current status
    get().fetchClaudeStatus();
  },

  closeLoginPanel() {
    set({ loginPanelOpen: false, loginPhase: 'options', loginUrl: null, loginError: null });
    // Cancel any in-progress login
    fetch('/api/auth/claude/login-cancel', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  },

  async fetchClaudeStatus() {
    try {
      const res = await fetch('/api/auth/claude/status', { credentials: 'same-origin' });
      const data = await res.json();
      set({ loginStatus: data });
    } catch {
      set({ loginStatus: null });
    }
  },

  async claudeLogin(method: 'claude' | 'sso') {
    set({ loginPhase: 'waiting', loginError: null });
    try {
      const res = await fetch('/api/auth/claude/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ method }),
      });
      const data = await res.json();
      if (data.url) {
        set({ loginPhase: 'code', loginUrl: data.url });
        get().claudeLoginStartPolling();
      } else {
        set({ loginPhase: 'error', loginError: data.error ?? 'Failed to start login' });
      }
    } catch (err) {
      set({ loginPhase: 'error', loginError: String(err) });
    }
  },

  claudeLoginStartPolling() {
    // Poll every 3s to check if OAuth completed
    const poll = async () => {
      const { loginPhase } = get();
      if (loginPhase !== 'code') return; // stopped
      try {
        const res = await fetch('/api/auth/claude/login-poll', {
          credentials: 'same-origin',
        });
        const data = await res.json();
        if (data.pending) {
          setTimeout(poll, 3000); // keep polling
        } else if (data.success) {
          set({ loginPhase: 'success', loginStatus: data.status ?? null });
        } else if (data.error) {
          set({ loginPhase: 'error', loginError: data.error });
        }
      } catch {
        setTimeout(poll, 3000); // retry on network error
      }
    };
    setTimeout(poll, 3000); // first poll after 3s
  },

  async claudeLoginSubmitCode(code: string) {
    try {
      await fetch('/api/auth/claude/login-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ code }),
      });
      // Result will come via polling — don't change phase here
    } catch {
      // Ignore — polling will pick up result or error
    }
  },

  claudeLoginCancel() {
    fetch('/api/auth/claude/login-cancel', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    set({ loginPhase: 'options', loginUrl: null, loginError: null });
  },

  async claudeLogout() {
    set({ loginPhase: 'waiting' });
    try {
      const res = await fetch('/api/auth/claude/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (data.success) {
        set({ loginPhase: 'options', loginStatus: { loggedIn: false } });
      } else {
        set({ loginPhase: 'error', loginError: data.error ?? 'Logout failed' });
      }
    } catch (err) {
      set({ loginPhase: 'error', loginError: String(err) });
    }
  },

  setLanguage(lang: 'en' | 'zh') {
    localStorage.setItem('nb-lang', lang);
    set({ language: lang });
  },
});
