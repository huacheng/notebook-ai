import type {
  Notebook,
  Cell,
  CellType,
  CellStatus,
  CellOutput,
  SliceSection,
  NotebookListItem,
  PromptImage,
} from '@notebook-ai/shared';
import type { ProjectListItem } from './projectSlice';
import type { PluginStatusResponse } from '../api/plugin';

/**
 * Full combined store interface.
 * Imported by slice files to type StateCreator without circular deps.
 */
export interface NotebookStore {
  // ── Auth state ─────────────────────────────────────────────────────────
  authToken: string | null;
  authRequired: boolean | null;
  authError: string | null;
  authRetryAfter: number;
  authLoading: boolean;

  // ── Notebook state ─────────────────────────────────────────────────────
  notebook: Notebook | null;
  sliceLoading: boolean;
  notebookLoading: boolean;
  cellsOffset: number;
  loadingOlderCells: boolean;

  // ── Sidebar / history state ────────────────────────────────────────────
  sidebarOpen: boolean;
  notebookList: NotebookListItem[];
  notebookListLoading: boolean;
  activeNotebookId: string | null;
  workspaceDir: string | null;

  // ── UI state ───────────────────────────────────────────────────────────
  activeTab: 'notebook' | 'slice' | 'git';
  gitTabOpen: boolean;
  sessionNotice: string | null;
  latency: number | null;
  creatingNotebook: boolean;
  wsReconnectExhausted: boolean;
  openFiles: Record<string, { path: string; source: 'workspace' | 'library' | 'deliverables'; sessionId: string; projectId?: string; loading?: boolean }>;
  activeFileTabId: string | null;
  leftSidebarSplitRatio: number;
  fileViewerMaximized: boolean;
  sidebarWidth: number;
  rightPanelWidth: number;
  editMode: boolean;
  pendingDeletes: Set<string>;
  editSavePhase: 'idle' | 'saving' | 'error';
  editSaveError: string;
  pluginStatus: PluginStatusResponse | null;
  pluginLoading: boolean;
  pluginActionKey: string | null;
  pluginDismissed: boolean;
  pluginPanelOpen: boolean;
  pluginOverlay: string | null;
  modelPanelOpen: boolean;
  modelSwitching: boolean;

  // ── Project state ─────────────────────────────────────────────────────
  projects: ProjectListItem[];
  projectsLoading: boolean;
  activeProjectId: string | null;
  activeProjectPath: string | null;
  sidebarLevel: 'L1' | 'L2';
  fileBrowserPath: string;

  // ── Multi-notebook state ──────────────────────────────────────────────
  openNotebooks: Record<string, { notebook: Notebook; sessionId: string; scrollY: number; workspaceDir: string | null }>;
  activeNotebookTabId: string | null;
  streamBuffer: Record<string, { text: string; thinking: string }>;

  // ── Right panel state ─────────────────────────────────────────────────
  rightPanelOpen: boolean;
  rightPanelSplitRatio: number;

  // ── WebSocket state ────────────────────────────────────────────────────
  ws: WebSocket | null;
  wsStatus: 'disconnected' | 'connecting' | 'connected';
  sessionId: string | null;
  restartPhase: 'idle' | 'restarting' | 'done' | 'error';
  restartError: string;
  lastEventIndex: Record<string, number>;

  // ── Auth actions ───────────────────────────────────────────────────────
  checkAuthStatus(): Promise<void>;
  login(token: string): Promise<void>;
  logout(): void;

  // ── Sidebar / history actions ──────────────────────────────────────────
  toggleSidebar(): void;
  setSidebarOpen(open: boolean): void;
  fetchNotebookList(): Promise<void>;
  createNewNotebook(title: string, agent?: 'claude' | 'gemini'): Promise<void>;
  restoreNotebook(notebookId: string): Promise<void>;
  deleteNotebook(notebookId: string): Promise<void>;
  renameNotebook(notebookId: string, newTitle: string): Promise<void>;
  setCreatingNotebook(v: boolean): void;
  importNotebookFile(file: File): Promise<void>;

  // ── Notebook actions ───────────────────────────────────────────────────
  setNotebook(nb: Notebook): void;
  updateTitle(title: string): void;
  updateAgent(agent: 'claude' | 'gemini'): void;
  addCell(type: CellType, index?: number): void;
  submitPrompt(source: string, images?: PromptImage[]): void;
  removeCell(cellId: string): void;
  moveCell(cellId: string, direction: 'up' | 'down'): void;
  updateCellSource(cellId: string, source: string): void;
  setCellStatus(cellId: string, status: CellStatus): void;
  appendCellOutput(cellId: string, output: CellOutput): void;
  updateToolResult(cellId: string, toolUseId: string, content: string, isError?: boolean): void;
  setCellGitDiff(cellId: string, diff: string): void;
  prependCells(cells: Cell[], newOffset: number): void;
  setCellsOffset(offset: number): void;

  // ── Slice actions ──────────────────────────────────────────────────────
  generateSlice(): Promise<void>;
  updateSliceSections(sections: SliceSection[]): void;

  // ── UI actions ─────────────────────────────────────────────────────────
  setActiveTab(tab: 'notebook' | 'slice' | 'git'): void;
  openGitTab(): void;
  closeGitTab(): void;
  clearSessionNotice(): void;
  setLatency(ms: number | null): void;
  setWsReconnectExhausted(v: boolean): void;
  openFileTab(file: { path: string; source: 'workspace' | 'library' | 'deliverables'; sessionId: string; projectId?: string }): void;
  closeFileTab(tabId: string): void;
  setActiveFileTab(tabId: string): void;
  deactivateFileTab(): void;
  closeAllFileTabs(): void;
  closeProjectFileTabs(projectId: string, pathPrefix?: string): void;
  closeDeletedFileTabs(deletedPaths: string[]): void;
  setFileTabLoading(tabId: string, loading: boolean): void;
  setLeftSidebarSplitRatio(ratio: number): void;
  toggleFileViewerMaximized(): void;
  setSidebarWidth(px: number): void;
  setRightPanelWidth(px: number): void;
  setEditMode(on: boolean): void;
  togglePendingDelete(cellId: string): void;
  commitEdits(): void;
  checkPluginStatus(): Promise<void>;
  installPlugin(key: string): Promise<void>;
  uninstallPlugin(key: string): Promise<void>;
  addMarketplace(source: string): Promise<void>;
  removeMarketplace(name: string): Promise<void>;
  updateMarketplace(name?: string): Promise<void>;
  updatePlugin(key: string): Promise<void>;
  dismissPluginBanner(): void;
  openPluginPanel(): void;
  closePluginPanel(): void;
  openModelPanel(): void;
  closeModelPanel(): void;
  changeModel(model: string): void;

  // ── Project actions ───────────────────────────────────────────────────
  fetchProjects(): Promise<void>;
  createProject(title: string): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  importProject(file: File): Promise<void>;
  deleteProjectNotebook(projectId: string, notebookRelPath: string): Promise<void>;
  importProjectNotebook(projectId: string, file: File): Promise<void>;
  setActiveProject(id: string, path: string): void;
  goBackToProjectList(): void;
  navigateFileBrowser(subPath: string): void;
  createNotebook(projectId: string, title: string, agent?: 'claude' | 'gemini'): Promise<{ sessionId: string; notebookPath: string }>;

  // ── Multi-notebook actions ────────────────────────────────────────────
  openNotebookTab(notebookId: string, notebook: Notebook, sessionId: string, workspaceDir?: string | null): void;
  closeNotebookTab(notebookId: string): void;
  closeProjectNotebookTabs(projectId: string): void;
  setActiveNotebookTab(notebookId: string): void;
  appendStreamDelta(cellId: string, delta: string, blockType: 'text' | 'thinking'): void;
  flushStreamBuffer(cellId: string): string;

  // ── Right panel actions ───────────────────────────────────────────────
  toggleRightPanel(): void;
  setRightPanelOpen(open: boolean): void;
  setRightPanelSplitRatio(ratio: number): void;

  // ── URL Capture ────────────────────────────────────────────────────────
  urlCapturing: boolean;
  captureUrl(url: string): void;

  // ── SuggestNextStep ──────────────────────────────────────────────────
  pendingSuggestions: { cellId: string; suggestions: string[] } | null;
  setPendingSuggestions(s: { cellId: string; suggestions: string[] }): void;
  clearPendingSuggestions(): void;

  // ── WebSocket actions ──────────────────────────────────────────────────
  connectWebSocket(): Promise<void>;
  disconnectWebSocket(): void;
  subscribeToSession(sessionId: string): void;
  unsubscribeFromSession(sessionId: string): void;
  updateLastEventIndex(sessionId: string, index: number): void;
  executeCell(cellId: string): void;
  saveNotebook(path?: string): void;
  loadNotebook(path: string): void;
  exportHtml(): void;
  restartSession(): void;
  rerunNotebook(): void;
  interruptCell(): void;
  submitToolResult(sessionId: string, toolUseId: string, content: string): void;
}
