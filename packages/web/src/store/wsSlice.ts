import type { StateCreator } from 'zustand';
import type { WSServerMessage } from '@notebook-ai/shared';
import type { NotebookStore } from './types';

export const createWsSlice: StateCreator<NotebookStore, [], [], Pick<NotebookStore,
  | 'ws' | 'wsStatus' | 'sessionId' | 'sessionRestarting'
  | 'connectWebSocket' | 'disconnectWebSocket' | 'subscribeToSession'
  | 'unsubscribeFromSession' | 'executeCell' | 'saveNotebook'
  | 'loadNotebook' | 'exportHtml' | 'restartSession'
>> = (set, get) => ({
  ws: null,
  wsStatus: 'disconnected',
  sessionId: null,
  sessionRestarting: false,

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
        const { sessionId } = get();
        if (sessionId) {
          ws.send(JSON.stringify({ type: 'subscribe', session_id: sessionId }));
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
      const store = get();
      switch (parsed.type) {
        case 'cell_output':
          store.appendCellOutput(parsed.cell_id, parsed.output);
          break;
        case 'cell_stream':
          store.appendStreamDelta(parsed.cell_id, parsed.delta, parsed.block_type);
          break;
        case 'tool_result':
          store.updateToolResult(parsed.cell_id, parsed.tool_use_id, parsed.content, parsed.is_error);
          break;
        case 'execution_complete':
          store.flushStreamBuffer(parsed.cell_id);
          store.setCellStatus(parsed.cell_id, 'completed');
          break;
        case 'git_diff':
          store.setCellGitDiff(parsed.cell_id, parsed.diff);
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
        case 'session_restarted':
          set({ sessionRestarting: false });
          break;
        case 'session_restart_failed':
          set({ sessionRestarting: false, sessionNotice: `Session restart failed: ${parsed.error}` });
          break;
        case 'error':
          if (parsed.cell_id) {
            store.setCellStatus(parsed.cell_id, 'error');
            store.appendCellOutput(parsed.cell_id, {
              type: 'error',
              message: parsed.message,
              timestamp: new Date().toISOString(),
            });
          }
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

  subscribeToSession(sessionId) {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', session_id: sessionId }));
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
      set({ sessionRestarting: true });
      ws.send(JSON.stringify({ type: 'restart_session', session_id: sessionId }));
    }
  },
});
