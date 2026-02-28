import type { StateCreator } from 'zustand';
import type { WSServerMessage } from '@notebook-ai/shared';
import type { NotebookStore } from './types';
import { applyToSession } from './wsRouting';
import {
  appendOutputToNotebook,
  setCellStatusInNotebook,
  updateToolResultInNotebook,
  setCellGitDiffInNotebook,
} from './notebookMutations';

export const createWsSlice: StateCreator<NotebookStore, [], [], Pick<NotebookStore,
  | 'ws' | 'wsStatus' | 'sessionId' | 'restartPhase' | 'restartError'
  | 'lastEventIndex' | 'updateLastEventIndex'
  | 'connectWebSocket' | 'disconnectWebSocket' | 'subscribeToSession'
  | 'unsubscribeFromSession' | 'executeCell' | 'saveNotebook'
  | 'loadNotebook' | 'exportHtml' | 'restartSession' | 'rerunNotebook'
  | 'interruptCell'
>> = (set, get) => ({
  ws: null,
  wsStatus: 'disconnected',
  sessionId: null,
  restartPhase: 'idle',
  restartError: '',
  lastEventIndex: {},

  connectWebSocket() {
    const existing = get().ws;
    if (existing) {
      existing.onclose = null;
      existing.onerror = null;
      existing.onmessage = null;
      existing.close();
    }

    set({ wsStatus: 'connecting', latency: null });

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = get().authToken;
    const wsUrl = token
      ? `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`
      : `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

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
      if (get().ws === ws) {
        set({ wsStatus: 'connected' });
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
      }
    };

    ws.onclose = () => {
      if (get().ws === ws) {
        stopPing();
        set({ wsStatus: 'disconnected', ws: null, latency: null });
      }
    };

    ws.onerror = () => {
      if (get().ws === ws) {
        stopPing();
        set({ wsStatus: 'disconnected', ws: null, latency: null });
      }
    };

    ws.onmessage = (event: MessageEvent) => {
      let parsed: WSServerMessage;
      try {
        parsed = JSON.parse(event.data as string) as WSServerMessage;
      } catch {
        return;
      }
      // Track event_index for resume-after
      const eventIndex = (parsed as any).event_index;
      const eventSessionId = (parsed as any).session_id;
      if (typeof eventIndex === 'number' && typeof eventSessionId === 'string') {
        set((state) => ({
          lastEventIndex: { ...state.lastEventIndex, [eventSessionId]: eventIndex },
        }));
      }
      const store = get();
      const msgSessionId = (parsed as any).session_id as string | undefined;
      switch (parsed.type) {
        case 'cell_output':
          if (msgSessionId) {
            set((state) => applyToSession(state, msgSessionId, (nb) =>
              appendOutputToNotebook(nb, parsed.cell_id, parsed.output)));
          } else {
            store.appendCellOutput(parsed.cell_id, parsed.output);
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
              setCellStatusInNotebook(nb, parsed.cell_id, (parsed as any).status ?? 'completed')));
          } else {
            store.setCellStatus(parsed.cell_id, (parsed as any).status ?? 'completed');
          }
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

          const blob = new Blob([parsed.html], { type: 'text/html' });
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
        case 'slice_update':
          set((state) => {
            if (!state.notebook) return {};
            return {
              notebook: {
                ...state.notebook,
                slice: {
                  ...state.notebook.slice,
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
            sessionNotice: '此 Notebook 已在另一个标签页中打开，请先关闭它。',
          });
          break;
        case 'cells_removed':
          set((s: any) => {
            const pending = s.pendingDeletes as Set<string>;
            return {
              notebook: s.notebook ? {
                ...s.notebook,
                cells: s.notebook.cells.filter((c: any) => !pending.has(c.id)),
              } : null,
              editMode: false,
              pendingDeletes: new Set<string>(),
              editSavePhase: 'idle',
              editSaveError: '',
            };
          });
          break;
        case 'cells_loaded': {
          const { cells, offset } = parsed as any;
          store.prependCells(cells, offset);
          set({ loadingOlderCells: false });
          break;
        }
        case 'cells_remove_failed':
          set({ editSavePhase: 'error', editSaveError: (parsed as any).error ?? 'Unknown error' });
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
                cells: state.notebook.cells.map((c: any) => ({
                  ...c,
                  ...(c.outputs ? { outputs: [] } : {}),
                  status: 'pending',
                })),
              },
            };
          });
          break;
        case 'rerun_failed':
          // Surface rerun error via restartPhase/restartError (shared UI)
          set({ restartPhase: 'error', restartError: (parsed as any).error ?? 'Rerun failed' });
          break;
        case 'cell_interrupted':
          // No-op: the actual cell completion comes via execution_complete
          break;
        case 'model_changed': {
          const newModel = (parsed as any).model as string;
          const changedSessionId = (parsed as any).session_id as string;
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
        case 'system_message':
          // Log system messages (e.g. context compaction) for future UI display
          console.log(`[ws] system: ${(parsed as any).subtype} — ${(parsed as any).message}`);
          break;
        case 'git_changed':
          window.dispatchEvent(new CustomEvent('nb:git-changed', { detail: parsed }));
          break;
        case 'files_changed':
          window.dispatchEvent(new CustomEvent('nb:files-changed', { detail: parsed }));
          break;
        case 'notebook_opened':
          window.dispatchEvent(new CustomEvent('nb:notebook-opened', { detail: parsed }));
          break;
        case 'notebook_open_error':
          window.dispatchEvent(new CustomEvent('nb:notebook-open-error', { detail: parsed }));
          break;
        case 'git_log_response':
          window.dispatchEvent(new CustomEvent('nb:git-log-response', { detail: parsed }));
          break;
        case 'git_log_error':
          window.dispatchEvent(new CustomEvent('nb:git-log-error', { detail: parsed }));
          break;
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

    set({ ws });
  },

  disconnectWebSocket() {
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
  },

  executeCell(cellId) {
    const { ws, notebook } = get();
    const cell = notebook?.cells.find((c) => c.id === cellId);
    if (!cell || cell.type !== 'prompt') return;

    set((state) => {
      if (!state.notebook) return {};
      return {
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
            include_slice: true,
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
});
