import type { StateCreator } from 'zustand';
import type { WSServerMessage } from '@notebook-ai/shared';
import type { NotebookStore } from './types';
import type { Command } from '../mention/types';
import DOMPurify from 'dompurify';
import * as lz4 from 'lz4js';
import { applyToSession } from './wsRouting';
import {
  appendOutputToNotebook,
  setCellStatusInNotebook,
  updateToolResultInNotebook,
  setCellGitDiffInNotebook,
} from './notebookMutations';
import { handleFilesPush } from '../utils/wsFilesPush';

// Module-level tracker for WS in CONNECTING state (not yet stored in zustand).
// Prevents race conditions when connectWebSocket is called multiple times.
let _pendingWs: WebSocket | null = null;

export const createWsSlice: StateCreator<NotebookStore, [], [], Pick<NotebookStore,
  | 'ws' | 'wsStatus' | 'sessionId' | 'restartPhase' | 'restartError'
  | 'lastEventIndex' | 'updateLastEventIndex' | 'lastCompletedCellId' | 'lastAskQuestionCellId'
  | 'connectWebSocket' | 'disconnectWebSocket' | 'subscribeToSession'
  | 'unsubscribeFromSession' | 'executeCell' | 'saveNotebook'
  | 'loadNotebook' | 'exportHtml' | 'restartSession' | 'rerunNotebook'
  | 'interruptCell'
  | 'submitToolResult' | 'updateToolResultLocal'
  | 'pendingSuggestions' | 'setPendingSuggestions' | 'clearPendingSuggestions'
  | 'commands' | 'commandsLoaded' | 'setCommands'
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
      sendPing();
      pingTimer = setInterval(sendPing, PING_INTERVAL);
    };

    ws.onclose = () => {
      if (_pendingWs === ws) _pendingWs = null;
      if (get().ws === ws) {
        stopPing();
        // D3: Clear loadingCellIds on disconnect to avoid stuck loading states
        set({ wsStatus: 'disconnected', ws: null, latency: null, loadingCellIds: new Set<string>() });
      }
    };

    ws.onerror = () => {
      if (_pendingWs === ws) _pendingWs = null;
      if (get().ws === ws) {
        stopPing();
        set({ wsStatus: 'disconnected', ws: null, latency: null });
      }
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
          break;
        case 'execution_complete':
          store.flushStreamBuffer(parsed.cell_id);
          if (msgSessionId) {
            set((state) => applyToSession(state, msgSessionId, (nb) =>
              setCellStatusInNotebook(nb, parsed.cell_id, parsed.status ?? 'completed')));
          } else {
            store.setCellStatus(parsed.cell_id, parsed.status ?? 'completed');
          }
          // Set lastCompletedCellId for notification system
          set({ lastCompletedCellId: parsed.cell_id });
          break;
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
        case 'cells_removed':
          set((s) => ({
            notebook: s.notebook ? {
              ...s.notebook,
              cells: s.notebook.cells.filter((c) => !s.pendingDeletes.has(c.id)),
            } : null,
            editMode: false,
            pendingDeletes: new Set<string>(),
            editSavePhase: 'idle' as const,
            editSaveError: '',
          }));
          break;
        case 'cells_loaded': {
          store.prependCells(parsed.cells, parsed.offset);
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
      return {
        lastCompletedCellId: null,
        lastAskQuestionCellId: null,
        notebook: {
          ...state.notebook,
          cells: state.notebook.cells.map((c) =>
            c.id === cellId
              ? { ...c, outputs: [], status: 'running', execution_count: c.execution_count + 1 }
              : c
          ),
        },
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

  rerunNotebook() {
    const { ws, sessionId } = get();
    if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
      ws.send(JSON.stringify({ type: 'rerun_notebook', session_id: sessionId }));
    }
  },

  interruptCell() {
    const { ws, sessionId } = get();
    if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
      ws.send(JSON.stringify({ type: 'interrupt_cell', session_id: sessionId }));
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
});
