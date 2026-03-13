import type { StateCreator } from 'zustand';
import type { WSServerMessage, Cell, Notebook, PromptSegment } from '@notebook-ai/shared';
import type { NotebookStore } from './types';
import type { Command } from '../mention/types';
import DOMPurify from 'dompurify';
import * as lz4 from 'lz4js';
import { applyToSession } from './wsRouting';
import { cacheSet, cacheGet, cacheRemove, TTL } from '../utils/localCache';
import {
  appendOutputToNotebook,
  setCellStatusInNotebook,
  updateToolResultInNotebook,
  setCellGitDiffInNotebook,
} from './notebookMutations';
import { handleFilesPush } from '../utils/wsFilesPush';
import { applyAutoStatus } from './autoStatusSlice';

// Module-level tracker for WS in CONNECTING state (not yet stored in zustand).
// Prevents race conditions when connectWebSocket is called multiple times.
let _pendingWs: WebSocket | null = null;

export const createWsSlice: StateCreator<NotebookStore, [], [], Pick<NotebookStore,
  | 'ws' | 'wsStatus' | 'sessionId' | 'restartPhase' | 'restartError'
  | 'lastEventIndex' | 'updateLastEventIndex' | 'lastCompletedCellId' | 'lastAskQuestionCellId'
  | 'connectWebSocket' | 'disconnectWebSocket' | 'subscribeToSession'
  | 'unsubscribeFromSession' | 'executeCell' | 'saveNotebook'
  | 'loadNotebook' | 'exportHtml' | 'restartSession' | 'clearSession' | 'rerunNotebook'
  | 'interruptCell'
  | 'submitToolResult' | 'updateToolResultLocal'
  | 'pendingSuggestions' | 'setPendingSuggestions' | 'clearPendingSuggestions'
  | 'commands' | 'commandsLoaded' | 'setCommands'
  | 'appendPrompt'
  | 'pendingAutoCommand'
>> = (set, get) => ({
  ws: null,
  wsStatus: 'disconnected',
  sessionId: null,
  restartPhase: 'idle',
  restartError: '',
  lastEventIndex: {},
  lastCompletedCellId: null,
  lastAskQuestionCellId: null,
  commands: [] as Command[],
  commandsLoaded: false,
  pendingAutoCommand: null,

  async connectWebSocket() {
    // Clean up any pending (CONNECTING) WS from a previous call
    if (_pendingWs) {
      _pendingWs.onopen = null;
      _pendingWs.onclose = null;
      _pendingWs.onerror = null;
      _pendingWs.onmessage = null;
      _pendingWs.close();
      _pendingWs = null;
    }
    // Clean up existing connected WS in store
    const existing = get().ws;
    if (existing) {
      existing.onclose = null;
      existing.onerror = null;
      existing.onmessage = null;
      existing.close();
    }

    set({ wsStatus: 'connecting', ws: null, latency: null });

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = get().authToken;

    let wsUrl: string;
    if (token) {
      try {
        const res = await fetch('/api/auth/ws-ticket', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) {
          // D3: If auth fails (401/403), clear token and stop — don't enter reconnect loop
          if (res.status === 401 || res.status === 403) {
            sessionStorage.removeItem('nb-auth-token');
            set({ wsStatus: 'disconnected', authToken: null });
            return;
          }
          throw new Error('ticket fetch failed');
        }
        const { ticket } = await res.json() as { ticket: string };
        wsUrl = `${protocol}//${window.location.host}/ws?ticket=${encodeURIComponent(ticket)}`;
      } catch {
        set({ wsStatus: 'disconnected' });
        return;
      }
    } else {
      wsUrl = `${protocol}//${window.location.host}/ws`;
    }

    // After await: check if another connectWebSocket() has already started
    if (_pendingWs) return; // superseded by a newer call

    const ws = new WebSocket(wsUrl);
    _pendingWs = ws; // track until onopen promotes it to store

    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let pingSentAt = 0;

    const PING_INTERVAL = 10_000;
    const PONG_TIMEOUT  =  4_000;

    function sendPing() {
      if (ws.readyState !== WebSocket.OPEN) return;
      pingSentAt = performance.now();
      ws.send(JSON.stringify({ type: 'ping' }));
      pongTimeoutTimer = setTimeout(() => {
        if (pingSentAt > 0) {
          pingSentAt = 0;
          ws.close();
        }
      }, PONG_TIMEOUT);
    }

    function stopPing() {
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      if (pongTimeoutTimer) { clearTimeout(pongTimeoutTimer); pongTimeoutTimer = null; }
      pingSentAt = 0;
    }

    ws.onopen = () => {
      // Only promote to store if this is still the current pending WS
      if (_pendingWs !== ws) { ws.close(); return; }
      _pendingWs = null;
      // D3-3: Clear stale stream buffers on reconnect (stream context is invalidated)
      set({ ws, wsStatus: 'connected', streamBuffer: {} });
      // Re-subscribe to all open notebook sessions on reconnect
      const { openNotebooks, sessionId, lastEventIndex } = get();
      const subscribedIds = new Set(
        Object.values(openNotebooks).map((e) => e.sessionId).filter(Boolean),
      );
      // Also include the active sessionId for backward compat
      if (sessionId) subscribedIds.add(sessionId);
      for (const sid of subscribedIds) {
        const msg: Record<string, unknown> = { type: 'subscribe', session_id: sid };
        if (lastEventIndex[sid] !== undefined) {
          msg.resume_after = lastEventIndex[sid];
        }
        ws.send(JSON.stringify(msg));
      }
      // Auto-restore timer mode if it was active before disconnect/restart
      const savedTimer = cacheGet<{ sessionId: string; intervalMs: number }>('nb-timer-mode', TTL.LAST_NOTEBOOK);
      if (savedTimer && subscribedIds.has(savedTimer.sessionId)) {
        ws.send(JSON.stringify({ type: 'timer_start', session_id: savedTimer.sessionId, interval_ms: savedTimer.intervalMs }));
      }
      sendPing();
      pingTimer = setInterval(sendPing, PING_INTERVAL);
    };

    ws.onclose = () => {
      if (_pendingWs === ws) _pendingWs = null;
      if (get().ws === ws) {
        stopPing();
        // D3: Clear loadingCellIds on disconnect to avoid stuck loading states
        set({ wsStatus: 'disconnected', ws: null, latency: null, loadingCellIds: new Set<string>(), timerMode: false, timerIntervalSec: 0, timerIterationCount: 0, timerPaused: false, timerPausedResumeAt: 0 });
      }
    };

    ws.onerror = () => {
      if (_pendingWs === ws) _pendingWs = null;
      if (get().ws === ws) {
        stopPing();
        set({ wsStatus: 'disconnected', ws: null, latency: null });
      }
    };

    /**
     * Merge server cells into a local (possibly paginated) notebook.
     * - Updates existing local cells with server content (running cell outputs).
     * - Appends only cells that come AFTER the local tail in server order
     *   (truly new cells), ignoring older history cells not yet loaded.
     */
    const mergeServerCells = (
      localNb: Notebook, serverCells: Cell[], metadata?: Notebook['metadata'],
    ): Notebook => {
      const serverCellMap = new Map(serverCells.map((c) => [c.id, c]));
      // Update existing local cells with latest server content
      const merged = localNb.cells.map((c) => serverCellMap.get(c.id) ?? c);
      // Find where the local tail sits in the server array
      const localLastId = localNb.cells.length > 0
        ? localNb.cells[localNb.cells.length - 1].id : null;
      if (localLastId) {
        const tailIdx = serverCells.findIndex((c) => c.id === localLastId);
        if (tailIdx >= 0) {
          // Append only cells after the local tail (new cells created on other device)
          for (let i = tailIdx + 1; i < serverCells.length; i++) {
            merged.push(serverCells[i]);
          }
        }
        // If localLastId not found in server (deleted?), don't append anything
      } else if (serverCells.length > 0) {
        // Local is empty — take all server cells
        merged.push(...serverCells);
      }
      return { ...localNb, cells: merged, ...(metadata ? { metadata } : {}) };
    };

    ws.onmessage = (event: MessageEvent) => {
      // D2: guard against non-string data (e.g. Blob/ArrayBuffer from binary frames)
      if (typeof event.data !== 'string') return;
      let parsed: WSServerMessage;
      try {
        parsed = JSON.parse(event.data) as WSServerMessage;
      } catch {
        return;
      }
      // Server augments messages with event_index and session_id at transport layer
      const envelope = parsed as WSServerMessage & { event_index?: number; session_id?: string };
      // Track event_index for resume-after
      const eventIndex = envelope.event_index;
      const eventSessionId = envelope.session_id;
      if (typeof eventIndex === 'number' && typeof eventSessionId === 'string') {
        set((state) => ({
          lastEventIndex: { ...state.lastEventIndex, [eventSessionId]: eventIndex },
        }));
      }
      const store = get();
      const msgSessionId = envelope.session_id;

      switch (parsed.type) {
        case 'cell_created':
          // Multi-device sync: another client created a new cell
          if (msgSessionId) {
            set((state) => applyToSession(state, msgSessionId, (nb) => {
              // Only add if cell doesn't already exist
              if (nb.cells.some((c) => c.id === parsed.cell_id)) return nb;
              return {
                ...nb,
                cells: [
                  ...nb.cells,
                  {
                    id: parsed.cell_id,
                    type: 'prompt' as const,
                    source: parsed.source ?? '',
                    images: parsed.images,
                    outputs: [],
                    execution_count: 0,
                    status: 'idle' as const,
                  },
                ],
              };
            }));
          }
          break;
        case 'cell_status':
          // Multi-device sync: cell status changed (e.g., running)
          if (msgSessionId) {
            set((state) => applyToSession(state, msgSessionId, (nb) =>
              setCellStatusInNotebook(nb, parsed.cell_id, parsed.status)));
          } else {
            store.setCellStatus(parsed.cell_id, parsed.status);
          }
          break;
        case 'cell_output':
          if (msgSessionId) {
            set((state) => applyToSession(state, msgSessionId, (nb) =>
              appendOutputToNotebook(nb, parsed.cell_id, parsed.output)));
          } else {
            store.appendCellOutput(parsed.cell_id, parsed.output);
          }
          // Detect SuggestNextStep tool_use → auto-reply + show suggestions
          if (parsed.output.type === 'tool_use' && parsed.output.name === 'SuggestNextStep') {
            try {
              const input = parsed.output.input as { suggestions?: string[] };
              if (input?.suggestions && Array.isArray(input.suggestions) && input.suggestions.length > 0) {
                store.setPendingSuggestions({ cellId: parsed.cell_id, suggestions: input.suggestions });
                // Auto-reply acknowledged so the model can finish
                if (parsed.output.tool_use_id && msgSessionId) {
                  store.submitToolResult(msgSessionId, parsed.output.tool_use_id, 'acknowledged');
                }
              }
            } catch { /* ignore parse errors */ }
          }
          // Detect AskUserQuestion tool_use → trigger notification
          if (parsed.output.type === 'tool_use' && parsed.output.name === 'AskUserQuestion') {
            set({ lastAskQuestionCellId: parsed.cell_id });
          }
          break;
        case 'cell_stream':
          store.appendStreamDelta(parsed.cell_id, parsed.delta, parsed.block_type);
          break;
        case 'tool_result':
          if (msgSessionId) {
            set((state) => applyToSession(state, msgSessionId, (nb) =>
              updateToolResultInNotebook(nb, parsed.cell_id, parsed.tool_use_id, parsed.content, parsed.is_error ?? false)));
          } else {
            store.updateToolResult(parsed.cell_id, parsed.tool_use_id, parsed.content, parsed.is_error);
          }
          // Clear "Tool execution in progress" notice when tool completes
          if (get().sessionNotice?.includes('Tool execution')) {
            set({ sessionNotice: null });
          }
          break;
        case 'prompt_accepted': {
          const accepted = get().acceptedCellIds;
          set({ acceptedCellIds: new Set([...accepted, parsed.cell_id]) });
          break;
        }
        case 'execution_complete': {
          console.log('[ESC-DEBUG][FE][13] Received execution_complete, cell_id=', parsed.cell_id, 'status=', parsed.status);
          store.flushStreamBuffer(parsed.cell_id);
          if (msgSessionId) {
            set((state) => applyToSession(state, msgSessionId, (nb) =>
              setCellStatusInNotebook(nb, parsed.cell_id, parsed.status ?? 'completed')));
          } else {
            store.setCellStatus(parsed.cell_id, parsed.status ?? 'completed');
          }
          // Set lastCompletedCellId for notification system + clear acceptance tracking
          const acc = get().acceptedCellIds;
          if (acc.has(parsed.cell_id)) {
            const next = new Set(acc);
            next.delete(parsed.cell_id);
            set({ lastCompletedCellId: parsed.cell_id, acceptedCellIds: next });
          } else {
            set({ lastCompletedCellId: parsed.cell_id });
          }
          // Set tab notification for non-active notebook
          if (msgSessionId) {
            const state = get();
            const openNotebooks = state.openNotebooks;
            for (const [notebookId, entry] of Object.entries(openNotebooks)) {
              if (entry.sessionId === msgSessionId && notebookId !== state.activeNotebookTabId) {
                store.setTabNotification(notebookId, true);
                break;
              }
            }
          }
          break;
        }
        case 'git_diff':
          if (msgSessionId) {
            set((state) => applyToSession(state, msgSessionId, (nb) =>
              setCellGitDiffInNotebook(nb, parsed.cell_id, parsed.diff)));
          } else {
            store.setCellGitDiff(parsed.cell_id, parsed.diff);
          }
          break;
        case 'export_complete': {
          const title = store.notebook?.metadata.title ?? 'notebook';
          const slug = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          const date = new Date().toISOString().slice(0, 10);
          const filename = `${slug || 'notebook'}-${date}.html`;

          // D2: sanitize exported HTML to prevent XSS when user opens the file
          const cleanHtml = DOMPurify.sanitize(parsed.html, { WHOLE_DOCUMENT: true, FORCE_BODY: true });
          const blob = new Blob([cleanHtml], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          break;
        }
        case 'slide_update':
          set((state) => {
            if (!state.notebook) return {};
            return {
              notebook: {
                ...state.notebook,
                slide: {
                  ...state.notebook.slide,
                  generated: true,
                  sections: parsed.sections,
                  updated_at: new Date().toISOString(),
                },
              },
            };
          });
          break;
        case 'pong':
          if (pingSentAt > 0) {
            if (pongTimeoutTimer) { clearTimeout(pongTimeoutTimer); pongTimeoutTimer = null; }
            const rtt = Math.round(performance.now() - pingSentAt);
            pingSentAt = 0;
            if (get().ws === ws) set({ latency: rtt });
          }
          break;
        case 'session_already_open':
          set({
            notebook: null,
            sessionId: null,
            activeNotebookId: null,
            workspaceDir: null,
            sessionNotice: 'This notebook is already open in another tab. Please close it first.',
          });
          break;
        case 'cells_removed': {
          // Multi-device sync: use cell_ids from message, fallback to pendingDeletes for local delete
          const removedIds = parsed.cell_ids
            ? new Set(parsed.cell_ids as string[])
            : get().pendingDeletes;
          set((s) => ({
            notebook: s.notebook ? {
              ...s.notebook,
              cells: s.notebook.cells.filter((c) => !removedIds.has(c.id)),
            } : null,
            editMode: false,
            pendingDeletes: new Set<string>(),
            editSavePhase: 'idle' as const,
            editSaveError: '',
          }));
          break;
        }
        case 'cells_loaded': {
          // Decompress cells if compressed (LZ4)
          const msg = parsed as { cells?: unknown[]; cells_compressed?: string; offset: number };
          let cells = msg.cells;
          if (msg.cells_compressed && typeof msg.cells_compressed === 'string') {
            try {
              const compressed = Uint8Array.from(atob(msg.cells_compressed), c => c.charCodeAt(0));
              const decompressed = lz4.decompress(compressed);
              const text = new TextDecoder().decode(decompressed);
              cells = JSON.parse(text);
            } catch (e) {
              console.error('[ws] Failed to decompress cells:', e);
              set({ loadingOlderCells: false });
              break;
            }
          }
          if (cells && Array.isArray(cells) && cells.length > 0) {
            store.prependCells(cells as Cell[], msg.offset);
          }
          set({ loadingOlderCells: false });
          break;
        }
        case 'cells_remove_failed':
          set({ editSavePhase: 'error', editSaveError: parsed.error ?? 'Unknown error' });
          break;
        case 'session_restarted':
          set({ restartPhase: 'done' });
          setTimeout(() => {
            if (get().restartPhase === 'done') set({ restartPhase: 'idle' });
          }, 800);
          break;
        case 'session_restart_failed':
          set({ restartPhase: 'error', restartError: parsed.error ?? 'Unknown error' });
          break;
        case 'rerun_started':
          // Rerun initiated: clear all cell outputs and reset status to pending
          set((state) => {
            if (!state.notebook) return {};
            return {
              notebook: {
                ...state.notebook,
                cells: state.notebook.cells.map((c) => ({
                  ...c,
                  ...('outputs' in c ? { outputs: [] } : {}),
                  status: 'pending' as const,
                })),
              },
            };
          });
          break;
        case 'rerun_failed':
          // Surface rerun error via restartPhase/restartError (shared UI)
          set({ restartPhase: 'error', restartError: parsed.error ?? 'Rerun failed' });
          break;
        case 'cell_interrupted':
          console.log('[ESC-DEBUG][FE][8] Received cell_interrupted from backend');
          // No-op: the actual cell completion comes via execution_complete
          break;
        case 'model_changed': {
          const newModel = parsed.model;
          const changedSessionId = parsed.session_id;
          set((state) => {
            // Update state.notebook if it matches
            const updatedNotebook = state.notebook
              ? { ...state.notebook, metadata: { ...state.notebook.metadata, model: newModel } }
              : null;
            // Update the matching entry in openNotebooks
            const updatedOpen = { ...state.openNotebooks };
            for (const [nbId, entry] of Object.entries(updatedOpen)) {
              if (entry.sessionId === changedSessionId) {
                updatedOpen[nbId] = {
                  ...entry,
                  notebook: { ...entry.notebook, metadata: { ...entry.notebook.metadata, model: newModel } },
                };
              }
            }
            return {
              notebook: updatedNotebook,
              openNotebooks: updatedOpen,
              modelPanelOpen: false,
              modelSwitching: false,
            };
          });
          break;
        }
        case 'system_message': {
          // Handle local_command_output as cell output (e.g. /context command)
          if (parsed.subtype === 'local_command_output' && parsed.cell_id && parsed.message) {
            const output = { type: 'text' as const, content: parsed.message, timestamp: new Date().toISOString() };
            if (msgSessionId) {
              set((state) => applyToSession(state, msgSessionId, (nb) =>
                appendOutputToNotebook(nb, parsed.cell_id!, output)));
            } else {
              store.appendCellOutput(parsed.cell_id, output);
            }
          }
          break;
        }
        case 'git_changed':
          window.dispatchEvent(new CustomEvent('nb:git-changed', { detail: parsed }));
          break;
        case 'files_changed': {
          const deleted = handleFilesPush(parsed);
          if (deleted.length > 0) {
            store.closeDeletedFileTabs(deleted);
          }
          window.dispatchEvent(new CustomEvent('nb:files-changed', { detail: parsed }));
          break;
        }
        case 'notebook_opened': {
          // Decompress notebook if compressed (LZ4)
          const detail = { ...parsed } as Record<string, unknown>;
          if (detail.notebook_compressed && typeof detail.notebook_compressed === 'string') {
            try {
              const compressed = Uint8Array.from(atob(detail.notebook_compressed), c => c.charCodeAt(0));
              const decompressed = lz4.decompress(compressed);
              const text = new TextDecoder().decode(decompressed);
              detail.notebook = JSON.parse(text);
              delete detail.notebook_compressed;
              delete detail.compression;
            } catch (e) {
              console.error('[ws] Failed to decompress notebook:', e);
            }
          }
          window.dispatchEvent(new CustomEvent('nb:notebook-opened', { detail }));
          break;
        }
        case 'notebook_open_error':
          window.dispatchEvent(new CustomEvent('nb:notebook-open-error', { detail: parsed }));
          break;
        case 'cell_loaded': {
          // D1: Verify session_id matches before processing
          const { cell_id, cell_compressed, session_id: loadedSessionId } = parsed as {
            cell_id: string;
            cell_compressed: string;
            session_id?: string;
          };
          // Skip if session doesn't match (stale response from different session)
          if (loadedSessionId && loadedSessionId !== store.sessionId) break;

          try {
            const compressed = Uint8Array.from(atob(cell_compressed), c => c.charCodeAt(0));
            const decompressed = lz4.decompress(compressed);
            const text = new TextDecoder().decode(decompressed);
            const fullCell = JSON.parse(text);
            store.replaceCellStub(cell_id, fullCell);
          } catch (e) {
            console.error('[ws] Failed to decompress cell:', e);
            // D3: Clean up loadingCellIds on decompression failure
            set(state => {
              const newLoadingIds = new Set(state.loadingCellIds);
              newLoadingIds.delete(cell_id);
              return { loadingCellIds: newLoadingIds };
            });
          }
          break;
        }
        case 'cell_load_error': {
          const { cell_id } = parsed as { cell_id: string };
          // Remove from loading set on error
          set(state => {
            const newLoadingIds = new Set(state.loadingCellIds);
            newLoadingIds.delete(cell_id);
            return { loadingCellIds: newLoadingIds };
          });
          console.error('[ws] cell_load_error:', parsed);
          break;
        }
        case 'git_log_response':
          window.dispatchEvent(new CustomEvent('nb:git-log-response', { detail: parsed }));
          break;
        case 'git_log_error':
          window.dispatchEvent(new CustomEvent('nb:git-log-error', { detail: parsed }));
          break;
        case 'git_commit_files_response':
          window.dispatchEvent(new CustomEvent('nb:git-commit-files-response', { detail: parsed }));
          break;
        case 'git_commit_files_error':
          window.dispatchEvent(new CustomEvent('nb:git-commit-files-error', { detail: parsed }));
          break;
        case 'git_diff_response':
          window.dispatchEvent(new CustomEvent('nb:git-diff-response', { detail: parsed }));
          break;
        case 'git_diff_error':
          window.dispatchEvent(new CustomEvent('nb:git-diff-error', { detail: parsed }));
          break;
        case 'autosave_error': {
          // D3-fix: Show autosave failure notification to user
          const errorMsg = (parsed as { error?: string }).error ?? 'Failed to save notebook';
          set({ sessionNotice: `⚠️ ${errorMsg}` });
          break;
        }
        case 'cell_appended': {
          const appendMsg = parsed as { session_id?: string; cell_id: string; segment: PromptSegment };
          const appendSid = appendMsg.session_id ?? msgSessionId;
          if (appendSid) {
            set((state) => applyToSession(state, appendSid, (nb) => ({
              ...nb,
              cells: nb.cells.map((c) =>
                c.id === appendMsg.cell_id && c.type === 'prompt'
                  ? { ...c, segments: [...(('segments' in c && c.segments) || []), appendMsg.segment] }
                  : c
              ),
            })));
          }
          break;
        }
        // ── Heartbeat events ──────────────────────────────────────────────────
        case 'process_dead': {
          const deadMsg = parsed as { cell_id: string };
          console.error(`[heartbeat] Agent process died while cell "${deadMsg.cell_id}" was running`);
          set({ sessionNotice: '⚠️ Agent process terminated unexpectedly' });
          break;
        }
        case 'stuck_exhausted': {
          const stuckMsg = parsed as { cell_id: string; retries: number };
          console.error(`[heartbeat] Cell "${stuckMsg.cell_id}" stuck after ${stuckMsg.retries} retries`);
          set({ sessionNotice: `⚠️ Cell stuck and unresponsive after ${stuckMsg.retries} retries` });
          break;
        }
        case 'tool_long_running': {
          const toolMsg = parsed as { cell_id: string; elapsed_ms: number; pending_tools: number };
          const mins = Math.round(toolMsg.elapsed_ms / 60000);
          console.log(`[heartbeat] Tool running for ${mins}+ minutes (cell: ${toolMsg.cell_id})`);
          set({ sessionNotice: `ℹ️ Tool execution in progress (${mins}+ min)...` });
          break;
        }
        case 'auto_status': {
          const asSid = (parsed as any).session_id ?? msgSessionId;
          set((state) => {
            const newStatus = applyAutoStatus(state.autoStatus, parsed);
            const updates: Record<string, unknown> = {
              autoStatuses: asSid
                ? { ...state.autoStatuses, [asSid]: newStatus }
                : state.autoStatuses,
            };
            // Only update flat state if this is the active session
            if (!asSid || asSid === state.sessionId) {
              updates.autoStatus = newStatus;
            }
            return updates;
          });
          break;
        }
        case 'task_status': {
          const tsSid = (parsed as any).session_id ?? msgSessionId;
          const status = (parsed as any).status;
          set((state) => {
            const updates: Record<string, unknown> = {};
            // Store per-session task status
            if (tsSid) {
              updates.taskStatuses = { ...state.taskStatuses, [tsSid]: status };
            }
            // Update flat state if this is the active session
            if (!tsSid || tsSid === state.sessionId) {
              updates.taskStatus = status;
            }
            return updates;
          });
          break;
        }
        case 'timer_heartbeat': {
          // Timer mode heartbeat tick — update iteration count
          const hbSid = (parsed as any).session_id ?? msgSessionId;
          if (!hbSid || hbSid === get().sessionId) {
            set({
              timerIterationCount: (parsed as any).iteration ?? 0,
            });
          }
          break;
        }
        case 'timer_stopped': {
          // Timer mode was stopped (by Esc, explicit stop, or process death)
          const asSid2 = (parsed as any).session_id ?? msgSessionId;
          if (!asSid2 || asSid2 === get().sessionId) {
            set({ timerMode: false, timerIntervalSec: 0, timerIterationCount: 0, timerPaused: false, timerPausedResumeAt: 0 });
            cacheRemove('nb-timer-mode');
          }
          break;
        }
        case 'timer_started': {
          const asSid3 = (parsed as any).session_id ?? msgSessionId;
          if (!asSid3 || asSid3 === get().sessionId) {
            const intervalMs = (parsed as any).interval_ms ?? 0;
            const timerIntervalSec = Math.round(intervalMs / 1000);
            set({ timerMode: true, timerIntervalSec, timerPaused: false, timerPausedResumeAt: 0 });
            // Persist timer state so it survives server restart / page refresh
            cacheSet('nb-timer-mode', { sessionId: asSid3, intervalMs }, TTL.LAST_NOTEBOOK);
          }
          break;
        }
        case 'timer_paused': {
          const apSid = (parsed as any).session_id ?? msgSessionId;
          if (!apSid || apSid === get().sessionId) {
            set({
              timerPaused: true,
              timerPausedResumeAt: (parsed as any).resume_at ?? 0,
            });
          }
          break;
        }
        case 'timer_resumed': {
          const arSid = (parsed as any).session_id ?? msgSessionId;
          if (!arSid || arSid === get().sessionId) {
            set({ timerPaused: false, timerPausedResumeAt: 0 });
          }
          break;
        }
        case 'notebook_digest': {
          // Cross-device sync: compare server cell state with local
          // Only compare last_cell_id — cell_count differs in paginated mode
          // (local has last N cells, server has all cells)
          const digestMsg = parsed as unknown as { session_id: string; cell_count: number; last_cell_id: string | null };
          if (digestMsg.session_id) {
            const localNb = Object.values(get().openNotebooks).find(
              (e) => e.sessionId === digestMsg.session_id,
            )?.notebook ?? (get().sessionId === digestMsg.session_id ? get().notebook : null);
            const localLastId = localNb && localNb.cells.length > 0
              ? localNb.cells[localNb.cells.length - 1].id
              : null;
            if (localLastId !== digestMsg.last_cell_id) {
              // Stale: request full notebook sync
              ws.send(JSON.stringify({
                type: 'notebook_sync_request',
                session_id: digestMsg.session_id,
              }));
            }
          }
          break;
        }
        case 'notebook_sync': {
          // Full notebook sync from server (cross-device catch-up)
          const syncMsg = parsed as unknown as { session_id: string; notebook?: Notebook; notebook_compressed?: string; compression?: string };
          // Decompress lz4 if needed
          if (syncMsg.notebook_compressed && syncMsg.compression === 'lz4') {
            try {
              const compressed = Uint8Array.from(atob(syncMsg.notebook_compressed), c => c.charCodeAt(0));
              const decompressed = lz4.decompress(compressed);
              syncMsg.notebook = JSON.parse(new TextDecoder().decode(decompressed));
            } catch (e) {
              console.error('[ws] Failed to decompress notebook_sync:', e);
              break;
            }
          }
          if (syncMsg.session_id && syncMsg.notebook) {
            set((state) => {
              const updates: Partial<typeof state> = {};
              const mergeInto = (localNb: Notebook): Notebook =>
                mergeServerCells(localNb, syncMsg.notebook!.cells, syncMsg.notebook!.metadata);
              const updatedOpen = { ...state.openNotebooks };
              for (const [nbId, entry] of Object.entries(updatedOpen)) {
                if (entry.sessionId === syncMsg.session_id) {
                  updatedOpen[nbId] = { ...entry, notebook: mergeInto(entry.notebook) };
                }
              }
              updates.openNotebooks = updatedOpen;
              if (state.sessionId === syncMsg.session_id && state.notebook) {
                updates.notebook = mergeInto(state.notebook);
              }
              return updates;
            });
          }
          break;
        }
        case 'session_state': {
          // Full notebook state sent on subscribe — merge running cell content
          // without replacing the paginated cells array (preserves lazy-load tail)
          const stateMsg = parsed as unknown as { session_id: string; notebook?: Notebook; notebook_compressed?: string; compression?: string };
          // Decompress LZ4 if needed
          if (stateMsg.notebook_compressed && stateMsg.compression === 'lz4') {
            try {
              const compressed = Uint8Array.from(atob(stateMsg.notebook_compressed), c => c.charCodeAt(0));
              const decompressed = lz4.decompress(compressed);
              stateMsg.notebook = JSON.parse(new TextDecoder().decode(decompressed));
            } catch (e) {
              console.error('[ws] Failed to decompress session_state:', e);
              break;
            }
          }
          if (stateMsg.session_id && stateMsg.notebook) {
            set((state) => {
              const updates: Partial<typeof state> = {};
              const mergeInto = (localNb: Notebook): Notebook =>
                mergeServerCells(localNb, stateMsg.notebook!.cells);
              const updatedOpen = { ...state.openNotebooks };
              for (const [nbId, entry] of Object.entries(updatedOpen)) {
                if (entry.sessionId === stateMsg.session_id) {
                  updatedOpen[nbId] = { ...entry, notebook: mergeInto(entry.notebook) };
                }
              }
              updates.openNotebooks = updatedOpen;
              if (state.sessionId === stateMsg.session_id && state.notebook) {
                updates.notebook = mergeInto(state.notebook);
              }
              return updates;
            });
          }
          break;
        }
        case 'session_ready': {
          // Session is fully ready (Claude process running) — fire pending auto command
          const readySid = (parsed as any).session_id as string | undefined;
          const pending = get().pendingAutoCommand;
          if (pending && readySid === pending.sessionId) {
            // Use setTimeout to ensure state is settled before submitting
            setTimeout(() => {
              const { submitPrompt } = get();
              submitPrompt(pending.command);
            }, 0);
            set({ pendingAutoCommand: null });
          }
          break;
        }
        case 'cell_removed': {
          // Server pruned an empty cell (e.g. empty CONTINUE cell)
          const rmCellId = (parsed as any).cell_id as string | undefined;
          if (rmCellId && msgSessionId) {
            set((state) => applyToSession(state, msgSessionId, (nb) => ({
              ...nb,
              cells: nb.cells.filter((c) => c.id !== rmCellId),
            })));
          } else if (rmCellId) {
            set((state) => {
              if (!state.notebook) return state;
              return { notebook: { ...state.notebook, cells: state.notebook.cells.filter((c) => c.id !== rmCellId) } };
            });
          }
          break;
        }
        case 'error':
          if (parsed.cell_id) {
            const errorOutput = { type: 'error' as const, message: parsed.message, timestamp: new Date().toISOString() };
            if (msgSessionId) {
              set((state) => applyToSession(state, msgSessionId, (nb) => {
                const nb2 = setCellStatusInNotebook(nb, parsed.cell_id!, 'error');
                return appendOutputToNotebook(nb2, parsed.cell_id!, errorOutput);
              }));
            } else {
              store.setCellStatus(parsed.cell_id, 'error');
              store.appendCellOutput(parsed.cell_id, errorOutput);
            }
          } else {
            // Non-cell error (e.g. "Not subscribed", permission denied)
            // Surface via restartPhase overlay so user sees the failure
            const { restartPhase } = get();
            if (restartPhase === 'restarting' || !parsed.cell_id) {
              set({ restartPhase: 'error', restartError: parsed.message ?? 'Operation failed' });
            }
          }
          // Clear model switching overlay on any error (e.g. change_model failure)
          if (get().modelSwitching) set({ modelSwitching: false });
          break;
      }
    };

    // NOTE: ws is NOT stored here — it's promoted to store in onopen
    // to ensure store.ws is always OPEN. This prevents components from
    // calling ws.send() on a CONNECTING WebSocket.
  },

  disconnectWebSocket() {
    // Clean up pending WS
    if (_pendingWs) {
      _pendingWs.onopen = null;
      _pendingWs.onclose = null;
      _pendingWs.onerror = null;
      _pendingWs.onmessage = null;
      _pendingWs.close();
      _pendingWs = null;
    }
    const { ws } = get();
    if (ws) {
      ws.close();
    }
    set({ ws: null, wsStatus: 'disconnected' });
  },

  updateLastEventIndex(sessionId, index) {
    set((state) => ({
      lastEventIndex: { ...state.lastEventIndex, [sessionId]: index },
    }));
  },

  subscribeToSession(sessionId) {
    const { ws, lastEventIndex } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: Record<string, unknown> = { type: 'subscribe', session_id: sessionId };
      if (lastEventIndex[sessionId] !== undefined) {
        msg.resume_after = lastEventIndex[sessionId];
      }
      ws.send(JSON.stringify(msg));
      ws.send(JSON.stringify({ type: 'task_status_subscribe', session_id: sessionId }));
    }
  },

  unsubscribeFromSession(sessionId) {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'unsubscribe', session_id: sessionId }));
    }
    // D4-3: Clean up lastEventIndex entry to prevent unbounded growth
    set((state) => {
      const { [sessionId]: _, ...rest } = state.lastEventIndex;
      return { lastEventIndex: rest };
    });
  },

  executeCell(cellId) {
    const { ws, notebook } = get();
    const cell = notebook?.cells.find((c) => c.id === cellId);
    if (!cell || cell.type !== 'prompt') return;

    set((state) => {
      if (!state.notebook) return { lastCompletedCellId: null, lastAskQuestionCellId: null };
      const updated = setCellStatusInNotebook(
        { ...state.notebook, cells: state.notebook.cells.map((c) => c.id === cellId ? { ...c, outputs: [], execution_count: c.execution_count + 1 } : c) },
        cellId, 'running',
      );
      const tabId = state.activeNotebookTabId;
      const openSync = tabId && state.openNotebooks[tabId]
        ? { openNotebooks: { ...state.openNotebooks, [tabId]: { ...state.openNotebooks[tabId], notebook: updated } } }
        : {};
      return {
        lastCompletedCellId: null,
        lastAskQuestionCellId: null,
        notebook: updated,
        ...openSync,
      };
    });

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'execute_request',
          session_id: get().sessionId ?? '',
          cell_id: cellId,
          source: cell.source,
          ...('images' in cell && cell.images ? { images: cell.images } : {}),
          ...('image_refs' in cell && cell.image_refs ? { image_refs: cell.image_refs } : {}),
        })
      );
    } else {
      get().setCellStatus(cellId, 'error');
      get().appendCellOutput(cellId, {
        type: 'error',
        message: 'WebSocket not connected. Cannot execute cell.',
        timestamp: new Date().toISOString(),
      });
    }
  },

  saveNotebook(path = 'notebook.ai.json') {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'save_notebook', session_id: get().sessionId ?? '', path }));
    }
  },

  loadNotebook(path: string) {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'load_notebook', session_id: get().sessionId ?? '', path }));
    }
  },

  exportHtml() {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'export_html',
          session_id: get().sessionId ?? '',
          options: {
            include_slide: true,
            include_replay: true,
            include_annotations: true,
          },
        })
      );
    }
  },

  restartSession() {
    const { ws, sessionId } = get();
    if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
      set({ restartPhase: 'restarting', restartError: '' });
      ws.send(JSON.stringify({ type: 'restart_session', session_id: sessionId }));
    }
  },

  clearSession() {
    const { ws, sessionId } = get();
    if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
      set({ restartPhase: 'restarting', restartError: '' });
      // clear: true → skipResume on backend, truly clears Claude context
      ws.send(JSON.stringify({ type: 'restart_session', session_id: sessionId, clear: true }));
    }
  },

  rerunNotebook() {
    const { ws, sessionId } = get();
    if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
      ws.send(JSON.stringify({ type: 'rerun_notebook', session_id: sessionId }));
    }
  },

  interruptCell() {
    const { ws, sessionId } = get();
    console.log('[ESC-DEBUG][FE][1] interruptCell() called, ws=', ws?.readyState, 'sessionId=', sessionId);
    if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
      console.log('[ESC-DEBUG][FE][2] Sending interrupt_cell to backend');
      ws.send(JSON.stringify({ type: 'interrupt_cell', session_id: sessionId }));
      // Also stop timer mode if active — Esc stops everything
      if (get().timerMode) {
        console.log('[ESC-DEBUG][FE][2b] Sending timer_stop (timer was active)');
        ws.send(JSON.stringify({ type: 'timer_stop', session_id: sessionId }));
        set({ timerMode: false, timerIntervalSec: 0, timerIterationCount: 0, timerPaused: false, timerPausedResumeAt: 0 });
        cacheRemove('nb-timer-mode');
      }
    }
  },

  submitToolResult(sessionId: string, toolUseId: string, content: string) {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'tool_result_response',
        session_id: sessionId,
        tool_use_id: toolUseId,
        content,
      }));
    }
  },

  // Update tool result in notebook only (no send to Claude CLI)
  // Used for AskUserQuestion workaround: persist user's actual choice
  updateToolResultLocal(sessionId: string, cellId: string, toolUseId: string, content: string) {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'update_tool_result',
        session_id: sessionId,
        cell_id: cellId,
        tool_use_id: toolUseId,
        content,
      }));
    }
  },

  // ── SuggestNextStep ──────────────────────────────────────────────────
  pendingSuggestions: null,

  setPendingSuggestions(s: { cellId: string; suggestions: string[] }) {
    set({ pendingSuggestions: s });
  },

  clearPendingSuggestions() {
    set({ pendingSuggestions: null });
  },

  // ── Commands (slash command caching) ────────────────────────────────
  setCommands: (commands: Command[]) => set({ commands, commandsLoaded: true }),

  // ── Prompt Append ───────────────────────────────────────────────────────
  appendPrompt(cellId: string, source: string, images?, imageRefs?) {
    const { ws, sessionId } = get();
    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId) {
      set({ sessionNotice: '⚠️ Not connected — prompt not sent' });
      return;
    }

    ws.send(JSON.stringify({
      type: 'append_prompt',
      session_id: sessionId,
      cell_id: cellId,
      source,
      ...(images ? { images } : {}),
      ...(imageRefs ? { image_refs: imageRefs } : {}),
    }));
  },
});
