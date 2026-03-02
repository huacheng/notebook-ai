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
  | 'openFiles' | 'activeFileTabId' | 'fileViewerMaximized'
  | 'openFileTab' | 'closeFileTab' | 'setActiveFileTab' | 'deactivateFileTab' | 'closeAllFileTabs' | 'closeProjectFileTabs' | 'closeDeletedFileTabs' | 'setFileTabLoading'
  | 'toggleFileViewerMaximized'
  | 'leftSidebarSplitRatio' | 'setLeftSidebarSplitRatio'
  | 'rightPanelOpen' | 'rightPanelSplitRatio'
  | 'toggleRightPanel' | 'setRightPanelOpen' | 'setRightPanelSplitRatio'
  | 'sidebarWidth' | 'rightPanelWidth'
  | 'setSidebarWidth' | 'setRightPanelWidth'
  | 'editMode' | 'pendingDeletes' | 'editSavePhase' | 'editSaveError'
  | 'setEditMode' | 'togglePendingDelete' | 'commitEdits'
  | 'pluginStatus' | 'pluginLoading' | 'pluginActionKey' | 'pluginDismissed' | 'pluginPanelOpen' | 'pluginOverlay'
  | 'checkPluginStatus' | 'installPlugin' | 'uninstallPlugin' | 'addMarketplace' | 'removeMarketplace' | 'updateMarketplace' | 'updatePlugin'
  | 'dismissPluginBanner' | 'openPluginPanel' | 'closePluginPanel'
  | 'modelPanelOpen' | 'modelSwitching' | 'openModelPanel' | 'closeModelPanel' | 'changeModel'
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
  fileViewerMaximized: false,
  rightPanelOpen: false,
  rightPanelSplitRatio: 0.5,
  sidebarWidth: 272,
  rightPanelWidth: 300,
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
  language: (() => {
    if (typeof localStorage === 'undefined') return 'en';
    const stored = localStorage.getItem('nb-lang');
    return stored === 'zh' ? 'zh' : 'en';
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
    const tabId = `${file.source}::${file.path}`;
    set(s => ({
      openFiles: { ...s.openFiles, [tabId]: { ...file, loading: true } },
      activeFileTabId: tabId,
    }));
  },

  closeFileTab(tabId) {
    set(s => {
      const { [tabId]: _, ...rest } = s.openFiles;
      const ids = Object.keys(rest);
      const newActive = s.activeFileTabId === tabId
        ? (ids[0] ?? null)
        : s.activeFileTabId;
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
      return {
        openFiles: remaining,
        activeFileTabId: activeGone ? (ids[0] ?? null) : s.activeFileTabId,
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
      return {
        openFiles: remaining,
        activeFileTabId: activeGone ? (ids[0] ?? null) : s.activeFileTabId,
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

  toggleFileViewerMaximized() {
    set((s) => ({ fileViewerMaximized: !s.fileViewerMaximized }));
  },

  toggleRightPanel() {
    set((state) => ({ rightPanelOpen: !state.rightPanelOpen }));
  },

  setRightPanelOpen(open) {
    set({ rightPanelOpen: open });
  },

  setLeftSidebarSplitRatio(ratio) {
    set({ leftSidebarSplitRatio: Math.min(0.8, Math.max(0.2, ratio)) });
  },

  setRightPanelSplitRatio(ratio) {
    set({ rightPanelSplitRatio: ratio });
  },

  setSidebarWidth(px) {
    set({ sidebarWidth: Math.min(500, Math.max(120, px)) });
  },

  setRightPanelWidth(px) {
    set({ rightPanelWidth: Math.min(500, Math.max(120, px)) });
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
      const { authToken } = get();
      const status = await fetchPluginStatus(authToken);
      set({ pluginStatus: status, pluginLoading: false });
    } catch {
      set({ pluginLoading: false });
    }
  },

  async installPlugin(key: string) {
    set({ pluginActionKey: key, pluginOverlay: `plugin.installing|${key.split('@')[0]}` });
    try {
      const { authToken } = get();
      await apiInstallPlugin(authToken, key);
      // Restart all open notebooks to pick up plugin changes
      restartAllNotebooks(get);
      // Refresh plugin status
      const status = await fetchPluginStatus(authToken);
      set({ pluginStatus: status, pluginActionKey: null, pluginOverlay: null });
    } catch {
      set({ pluginActionKey: null, pluginOverlay: null });
    }
  },

  async uninstallPlugin(key: string) {
    set({ pluginActionKey: key, pluginOverlay: `plugin.uninstalling|${key.split('@')[0]}` });
    try {
      const { authToken } = get();
      await apiUninstallPlugin(authToken, key);
      restartAllNotebooks(get);
      const status = await fetchPluginStatus(authToken);
      set({ pluginStatus: status, pluginActionKey: null, pluginOverlay: null });
    } catch {
      set({ pluginActionKey: null, pluginOverlay: null });
    }
  },

  async addMarketplace(source: string) {
    set({ pluginOverlay: `plugin.addingMarket|${source}` });
    try {
      const { authToken } = get();
      await apiAddMarketplace(authToken, source);
      const status = await fetchPluginStatus(authToken);
      set({ pluginStatus: status, pluginOverlay: null });
    } catch {
      set({ pluginOverlay: null });
    }
  },

  async removeMarketplace(name: string) {
    set({ pluginOverlay: `plugin.removingMarket|${name}` });
    try {
      const { authToken } = get();
      await apiRemoveMarketplace(authToken, name);
      const status = await fetchPluginStatus(authToken);
      set({ pluginStatus: status, pluginOverlay: null });
    } catch {
      set({ pluginOverlay: null });
    }
  },

  async updateMarketplace(name?: string) {
    set({ pluginOverlay: name ? `plugin.updatingMarket|${name}` : 'plugin.updatingAll' });
    try {
      const { authToken } = get();
      await apiUpdateMarketplace(authToken, name);
      restartAllNotebooks(get);
      const status = await fetchPluginStatus(authToken);
      set({ pluginStatus: status, pluginOverlay: null });
    } catch {
      set({ pluginOverlay: null });
    }
  },

  async updatePlugin(key: string) {
    set({ pluginActionKey: key, pluginOverlay: `plugin.updatingPlugin|${key.split('@')[0]}` });
    try {
      const { authToken } = get();
      await apiUpdatePlugin(authToken, key);
      restartAllNotebooks(get);
      const status = await fetchPluginStatus(authToken);
      set({ pluginStatus: status, pluginActionKey: null, pluginOverlay: null });
    } catch {
      set({ pluginActionKey: null, pluginOverlay: null });
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

  setLanguage(lang: 'en' | 'zh') {
    localStorage.setItem('nb-lang', lang);
    set({ language: lang });
  },
});
