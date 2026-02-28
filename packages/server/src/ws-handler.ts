import { type WebSocketServer, type WebSocket } from 'ws';
import crypto from 'crypto';
import fs from 'fs/promises';
import {
  WSClientMessageSchema,
  type Notebook,
} from '@notebook-ai/shared';
import type { SessionManager } from './session.js';
import type { NotebookDb } from './db.js';
import { NotebookStore } from './notebook-store.js';
import { authEnabled } from './auth.js';
import { validateWorkspacePath } from './workspace-files.js';
import { exportToHtml } from './export.js';
import { getLibraryDir } from './workspace.js';

function sendToClient(ws: WebSocket, msg: object): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function setupWebSocket(
  wss: WebSocketServer,
  db: NotebookDb,
  sessionManager: SessionManager,
  notebookStore: NotebookStore,
): void {
  // Purge stale file annotations on startup
  db.cleanupOldFileAnnotations(7);

  // Global: session_id → the one WS connection allowed to subscribe to it.
  const sessionOwners = new Map<string, WebSocket>();

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url ?? '/', `http://localhost`);
    const token = url.searchParams.get('token') ?? undefined;

    if (authEnabled) {
      const NB_AUTH_TOKEN = process.env['NB_AUTH_TOKEN'] ?? '';
      if (!token || token !== NB_AUTH_TOKEN) {
        sendToClient(ws, { type: 'error', message: 'Unauthorized.' });
        ws.close(4001, 'Unauthorized');
        return;
      }
    }

    const clientId = crypto.randomUUID();
    console.log(`[ws] Client ${clientId} connected`);

    // Per-connection subscription map: sessionId → removeListener
    const subscriptions = new Map<string, () => void>();

    ws.on('message', async (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        sendToClient(ws, { type: 'error', message: 'Invalid JSON.' });
        return;
      }

      const result = WSClientMessageSchema.safeParse(parsed);
      if (!result.success) {
        sendToClient(ws, {
          type: 'error',
          message: `Invalid message: ${result.error.message}`,
        });
        return;
      }

      const msg = result.data;

      switch (msg.type) {
        case 'subscribe': {
          const { session_id } = msg;
          if (subscriptions.has(session_id)) break;

          const owner = sessionOwners.get(session_id);
          if (owner && owner !== ws) {
            if (owner.readyState === owner.OPEN) {
              sendToClient(ws, { type: 'session_already_open', session_id });
              break;
            }
            // Old owner is closing/closed — allow takeover
            sessionOwners.delete(session_id);
          }

          let session = sessionManager.getSession(session_id);

          // Auto-restore: session not in memory (e.g. after server restart)
          // but exists in DB — recreate it transparently.
          if (!session) {
            const row = db.getActiveSessionByName(session_id);
            if (row) {
              try {
                let notebook;
                try {
                  notebook = await notebookStore.load(row.notebook_path);
                } catch {
                  notebook = notebookStore.createNew(row.title, row.workspace_dir);
                }
                const result = await sessionManager.reconnectSession(
                  session_id, row.notebook_path, row.workspace_dir,
                  notebook, row.jsonl_path, row.notebook_id,
                );
                session = result.session;
                if (!result.reconnected) {
                  db.closeSessionRecord(row.id);
                  db.createSessionRecord({
                    id: result.session.id,
                    notebook_id: row.notebook_id,
                    tmux_session: result.session.id,
                    jsonl_path: null,
                    cwd: row.workspace_dir,
                    status: 'active',
                    created_at: new Date().toISOString(),
                  });
                }
                console.log(`[ws] Auto-restored session ${session_id} from DB`);
              } catch (err) {
                console.error(`[ws] Failed to auto-restore session ${session_id}:`, err);
              }
            }
          }

          if (!session) {
            sendToClient(ws, {
              type: 'error',
              session_id,
              message: `Session "${session_id}" not found.`,
            });
            break;
          }
          const remove = sessionManager.addListener(session_id, (event) => {
            sendToClient(ws, event);
          });
          if (remove) {
            subscriptions.set(session_id, remove);
            sessionOwners.set(session_id, ws);
            console.log(`[ws] Client ${clientId} subscribed to session ${session_id}`);

            // Resume-after: replay buffered events the client missed
            if (msg.resume_after !== undefined) {
              const missed = sessionManager.getEventsAfter(session_id, msg.resume_after);
              for (const { event } of missed) {
                sendToClient(ws, event as any);
              }
              if (missed.length > 0) {
                console.log(`[ws] Replayed ${missed.length} events for session ${session_id} (resume_after=${msg.resume_after})`);
              }
            }
          }
          break;
        }

        case 'unsubscribe': {
          const { session_id } = msg;
          const remove = subscriptions.get(session_id);
          if (remove) {
            remove();
            subscriptions.delete(session_id);
            if (sessionOwners.get(session_id) === ws) sessionOwners.delete(session_id);
            console.log(`[ws] Client ${clientId} unsubscribed from session ${session_id}`);
          }
          break;
        }

        case 'execute_request': {
          const { session_id, cell_id, source } = msg;
          try {
            await sessionManager.executeCell(session_id, cell_id, source);
          } catch (err) {
            sendToClient(ws, {
              type: 'error',
              session_id,
              message: String(err),
              cell_id,
            });
          }
          break;
        }

        case 'save_notebook': {
          const { session_id } = msg;
          const session = sessionManager.getSession(session_id);
          if (!session) {
            sendToClient(ws, { type: 'error', session_id, message: `Session "${session_id}" not found.` });
            break;
          }
          try {
            const safePath = await validateWorkspacePath(msg.path, session.cwd).catch(() => null);
            if (!safePath) {
              sendToClient(ws, { type: 'error', session_id, message: 'Save path is outside the workspace.' });
              break;
            }
            await notebookStore.save(safePath, session.notebook);
            console.log(`[ws] Notebook saved to "${safePath}"`);
            if (session.notebookDbId) {
              db.updateNotebook(session.notebookDbId, {
                cell_count: session.notebook.cells.length,
                updated_at: new Date().toISOString(),
              });
            }
          } catch (err) {
            sendToClient(ws, { type: 'error', session_id, message: String(err) });
          }
          break;
        }

        case 'load_notebook': {
          const { session_id } = msg;
          let notebook: Notebook;
          try {
            notebook = await notebookStore.load(msg.path);
          } catch (err) {
            sendToClient(ws, { type: 'error', session_id, message: String(err) });
            break;
          }
          const loadSession = sessionManager.getSession(session_id);
          if (loadSession) loadSession.notebook = notebook;
          console.log(`[ws] Notebook loaded from "${msg.path}"`);
          break;
        }

        case 'export_html': {
          const { session_id } = msg;
          const session = sessionManager.getSession(session_id);
          if (!session) {
            sendToClient(ws, {
              type: 'error',
              session_id,
              message: 'No notebook found for this session.',
            });
            break;
          }
          try {
            const html = await exportToHtml(session.notebook, { ...msg.options, minify: false });
            sendToClient(ws, { type: 'export_complete', session_id, html });
          } catch (err) {
            sendToClient(ws, { type: 'error', session_id, message: String(err) });
          }
          break;
        }

        case 'slice_update': {
          const { session_id } = msg;
          const session = sessionManager.getSession(session_id);
          if (session) {
            session.notebook = {
              ...session.notebook,
              slice: {
                ...session.notebook.slice,
                sections: msg.sections,
                updated_at: new Date().toISOString(),
              },
            };
          }
          break;
        }

        case 'ping': {
          sendToClient(ws, { type: 'pong' });
          break;
        }

        case 'update_cell_source': {
          const { session_id, cell_id, source } = msg;
          const session = sessionManager.getSession(session_id);
          if (session) {
            session.notebook = {
              ...session.notebook,
              cells: session.notebook.cells.map((c) =>
                c.id === cell_id ? { ...c, source } : c,
              ),
            };
          }
          break;
        }

        case 'file-open': {
          const { session_id, path: filePath, source, project_id } = msg;
          const session = sessionManager.getSession(session_id);
          if (!session && source !== 'library' && !project_id) {
            sendToClient(ws, { type: 'file-open-error', session_id, error: 'Session not found' });
            break;
          }
          try {
            let basedir: string;
            if (source === 'library') {
              basedir = getLibraryDir();
            } else if (source === 'deliverables') {
              const pid = project_id ?? session?.notebook.metadata.project_id;
              const project = pid ? db.getProject(pid) : null;
              if (!project) {
                sendToClient(ws, { type: 'file-open-error', session_id, error: 'Project not found for deliverables' });
                break;
              }
              basedir = project.path;
            } else {
              // workspace
              if (project_id) {
                const project = db.getProject(project_id);
                if (!project) {
                  sendToClient(ws, { type: 'file-open-error', session_id, error: 'Project not found' });
                  break;
                }
                basedir = project.path;
              } else {
                basedir = session!.cwd;
              }
            }

            const safePath = await validateWorkspacePath(filePath, basedir);
            const stat = await fs.stat(safePath);
            const ext = safePath.split('.').pop()?.toLowerCase() ?? '';

            const TEXT_EXTS = new Set(['md', 'txt', 'json', 'yaml', 'yml', 'sh', 'py', 'js', 'ts',
              'tsx', 'jsx', 'css', 'htm', 'html', 'csv', 'xml', 'toml', 'ini', 'env', 'log']);

            const BINARY_FORMAT: Record<string, string> = {
              pdf: 'pdf-binary', docx: 'docx-binary', xlsx: 'xlsx-binary', pptx: 'pptx-binary',
            };

            let format: string;

            if (TEXT_EXTS.has(ext)) {
              format = 'text';
            } else if (BINARY_FORMAT[ext]) {
              format = BINARY_FORMAT[ext];
            } else {
              format = 'unsupported';
            }

            sendToClient(ws, { type: 'file-open-meta', session_id, size: stat.size, mtime: stat.mtimeMs, format });

            if (format === 'unsupported') {
              sendToClient(ws, { type: 'file-open-end', session_id, mtime: stat.mtimeMs });
              break;
            }

            const fileContent = await fs.readFile(safePath);
            const CHUNK_SIZE = 16384;

            if (format.endsWith('-binary')) {
              const b64 = fileContent.toString('base64');
              for (let i = 0; i < b64.length; i += CHUNK_SIZE) {
                sendToClient(ws, { type: 'file-chunk', session_id, data: b64.slice(i, i + CHUNK_SIZE), encoding: 'base64' });
              }
            } else {
              const text = fileContent.toString('utf-8');
              for (let i = 0; i < text.length; i += CHUNK_SIZE) {
                sendToClient(ws, { type: 'file-chunk', session_id, data: text.slice(i, i + CHUNK_SIZE), encoding: 'utf8' });
              }
            }

            sendToClient(ws, { type: 'file-open-end', session_id, mtime: stat.mtimeMs });
          } catch (err) {
            sendToClient(ws, { type: 'file-open-error', session_id, error: String(err) });
          }
          break;
        }

        case 'file-save': {
          const { session_id, path: filePath, source, content, project_id } = msg;
          const session = sessionManager.getSession(session_id);
          if (!session && source !== 'library' && !project_id) {
            sendToClient(ws, { type: 'file-save-error', session_id, error: 'Session not found' });
            break;
          }
          try {
            let basedir: string;
            if (source === 'library') {
              basedir = getLibraryDir();
            } else if (source === 'deliverables') {
              const pid = project_id ?? session?.notebook.metadata.project_id;
              const project = pid ? db.getProject(pid) : null;
              if (!project) {
                sendToClient(ws, { type: 'file-save-error', session_id, error: 'Project not found for deliverables' });
                break;
              }
              basedir = project.path;
            } else {
              // workspace
              if (project_id) {
                const project = db.getProject(project_id);
                if (!project) {
                  sendToClient(ws, { type: 'file-save-error', session_id, error: 'Project not found' });
                  break;
                }
                basedir = project.path;
              } else {
                basedir = session!.cwd;
              }
            }

            const safePath = await validateWorkspacePath(filePath, basedir);
            await fs.writeFile(safePath, content, 'utf-8');

            const stat = await fs.stat(safePath);
            sendToClient(ws, { type: 'file-save-ok', session_id, mtime: stat.mtimeMs });
          } catch (err) {
            sendToClient(ws, { type: 'file-save-error', session_id, error: String(err) });
          }
          break;
        }

        case 'annotation-load': {
          const { session_id, path: filePath } = msg;
          const row = db.getFileAnnotations(session_id, filePath);
          sendToClient(ws, {
            type: 'annotation-data',
            session_id,
            path: filePath,
            content: row?.content ?? '{"items":[],"updatedAt":0}',
            updated_at: row?.updated_at ?? 0,
          });
          break;
        }

        case 'annotation-sync': {
          const { session_id, path: filePath, content, updated_at } = msg;
          db.upsertFileAnnotations(session_id, filePath, content, updated_at);
          sendToClient(ws, { type: 'annotation-sync-ok', session_id, path: filePath, updated_at });
          break;
        }

        case 'restart_session': {
          const { session_id } = msg;
          try {
            await sessionManager.restartSession(session_id);
            sendToClient(ws, { type: 'session_restarted', session_id });
          } catch (err) {
            sendToClient(ws, { type: 'session_restart_failed', session_id, error: String(err) });
          }
          break;
        }

        case 'rerun_notebook': {
          const { session_id } = msg;
          try {
            await sessionManager.rerunNotebook(session_id);
            sendToClient(ws, { type: 'rerun_started', session_id });
          } catch (err) {
            sendToClient(ws, { type: 'rerun_failed', session_id, error: String(err) });
          }
          break;
        }

        case 'interrupt_cell': {
          const { session_id } = msg;
          try {
            await sessionManager.interruptCell(session_id);
            sendToClient(ws, { type: 'cell_interrupted', session_id });
          } catch (err) {
            sendToClient(ws, { type: 'error', session_id, message: String(err) });
          }
          break;
        }

        case 'change_model': {
          const { session_id, model } = msg;
          try {
            await sessionManager.changeModel(session_id, model);
            sendToClient(ws, { type: 'model_changed', session_id, model });
          } catch (err) {
            sendToClient(ws, { type: 'error', session_id, message: String(err) });
          }
          break;
        }

        case 'load_cells': {
          const { session_id, offset, limit } = msg;
          const session = sessionManager.getSession(session_id);
          if (!session) {
            sendToClient(ws, { type: 'error', session_id, message: `Session "${session_id}" not found.` });
            break;
          }
          const cells = session.notebook.cells.slice(offset, offset + limit);
          sendToClient(ws, { type: 'cells_loaded', session_id, cells, offset });
          break;
        }

        case 'remove_cells': {
          const { session_id, cell_ids } = msg;
          const session = sessionManager.getSession(session_id);
          if (!session) {
            sendToClient(ws, { type: 'error', session_id, message: `Session "${session_id}" not found.` });
            break;
          }
          try {
            const cellIdSet = new Set(cell_ids);
            session.notebook.cells = session.notebook.cells.filter(c => !cellIdSet.has(c.id));
            await notebookStore.save(session.notebookPath, session.notebook);
            if (session.notebookDbId) {
              db.updateNotebook(session.notebookDbId, {
                cell_count: session.notebook.cells.length,
                updated_at: new Date().toISOString(),
              });
            }
            sendToClient(ws, { type: 'cells_removed', session_id });
          } catch (err) {
            sendToClient(ws, { type: 'cells_remove_failed', session_id, error: String(err) });
          }
          break;
        }

        default: {
          msg satisfies never;
          sendToClient(ws, { type: 'error', message: 'Unknown message type.' });
          break;
        }
      }
    });

    function cleanup() {
      for (const [session_id, remove] of subscriptions.entries()) {
        remove();
        if (sessionOwners.get(session_id) === ws) sessionOwners.delete(session_id);
      }
      subscriptions.clear();
    }

    ws.on('close', () => {
      console.log(`[ws] Client ${clientId} disconnected`);
      cleanup();
    });

    ws.on('error', (err) => {
      console.error(`[ws] Client ${clientId} error:`, err.message);
      cleanup();
    });
  });
}
