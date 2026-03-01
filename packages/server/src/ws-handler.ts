import { type WebSocketServer, type WebSocket } from 'ws';
import crypto from 'crypto';
import fs from 'fs/promises';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import {
  WSClientMessageSchema,
  type Notebook,
} from '@notebook-ai/shared';
import type { SessionManager } from './session.js';
import type { NotebookDb } from './db.js';
import { NotebookStore } from './notebook-store.js';
import { openNotebookByPath } from './routes/notebooks.js';
import { authEnabled, consumeWsTicket } from './auth.js';
import { listWorkspaceFiles, validateWorkspacePath } from './workspace-files.js';
import { exportToHtml } from './export.js';
import { getLibraryDir } from './workspace.js';
import { unquoteGitPath } from './git-utils.js';
import type { GitWatcher, FileWatcher } from './watcher.js';
import { computeFileCacheKey, computeProjectFileList } from './project-file-list.js';

const execFileAsync = promisify(execFileCb);
const EXEC_TIMEOUT = 10000;
const DEFAULT_GIT_LOG_LIMIT = 5;

/**
 * Compute git log for a repo path. Shared by git_log_request handler and git_changed push.
 */
export async function computeGitLog(
  cwd: string,
  opts: { page?: number; limit?: number; all?: boolean; stats?: boolean } = {},
): Promise<{ commits: unknown[]; total: number; page: number; limit: number }> {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? DEFAULT_GIT_LOG_LIMIT;
  const skip = (page - 1) * limit;

  const SEP = '---GIT-LOG-SEP---';
  const format = `${SEP}%n%H%n%h%n%P%n%D%n%s%n%an%n%aI`;
  const args = ['log', '--topo-order', `--pretty=format:${format}`, `--skip=${skip}`, `-${limit + 1}`];
  if (opts.stats) args.splice(3, 0, '--numstat');
  if (opts.all) args.splice(1, 0, '--all');

  const { stdout } = await execFileAsync('git', args, { cwd, timeout: EXEC_TIMEOUT });
  const commits: unknown[] = [];
  const blocks = stdout.split(SEP).filter((b: string) => b.trim());

  for (const block of blocks) {
    const rawLines = block.split('\n');
    if (rawLines[0] === '') rawLines.shift();
    if (rawLines.length < 7) continue;

    const [hash, shortHash, parentLine, refLine, message, author, date, ...fileLines] = rawLines;
    const parents = parentLine.trim() ? parentLine.trim().split(' ') : [];
    const refs: { type: string; name: string }[] = [];
    if (refLine.trim()) {
      for (const raw of refLine.split(',')) {
        const part = raw.trim();
        if (!part) continue;
        if (part.startsWith('HEAD -> ')) refs.push({ type: 'head', name: part.slice(8) });
        else if (part === 'HEAD') refs.push({ type: 'head', name: 'HEAD' });
        else if (part.startsWith('tag: ')) refs.push({ type: 'tag', name: part.slice(5) });
        else if (part.includes('/')) refs.push({ type: 'remote', name: part });
        else refs.push({ type: 'branch', name: part });
      }
    }
    const files: { path: string; additions: number; deletions: number }[] = [];
    for (const fl of fileLines) {
      const match = fl.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (match) {
        files.push({
          additions: match[1] === '-' ? 0 : parseInt(match[1], 10),
          deletions: match[2] === '-' ? 0 : parseInt(match[2], 10),
          path: unquoteGitPath(match[3]),
        });
      }
    }
    commits.push({ hash, shortHash, parents, refs, message, author, date, files });
  }

  const hasMore = commits.length > limit;
  if (hasMore) commits.pop();

  return { commits, total: commits.length, page, limit };
}

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
  gitWatcher?: GitWatcher,
  fileWatcher?: FileWatcher,
): void {
  // Purge stale file annotations on startup
  db.cleanupOldFileAnnotations(7);

  // Global: session_id → the one WS connection allowed to subscribe to it.
  const sessionOwners = new Map<string, WebSocket>();

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url ?? '/', `http://localhost`);
    const ticket = url.searchParams.get('ticket') ?? undefined;

    if (authEnabled) {
      if (!ticket || !consumeWsTicket(ticket)) {
        sendToClient(ws, { type: 'error', message: 'Unauthorized.' });
        ws.close(4001, 'Unauthorized');
        return;
      }
    }

    const clientId = crypto.randomUUID();
    console.log(`[ws] Client ${clientId} connected`);

    // Per-connection subscription map: sessionId → removeListener
    const subscriptions = new Map<string, () => void>();
    // Per-connection watcher subscriptions: watch_id → unsubscribe fn
    const watchSubscriptions = new Map<string, () => void>();

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
          const { session_id, cell_id, source, images } = msg;
          try {
            await sessionManager.executeCell(session_id, cell_id, source, images);
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

        case 'tool_result_response': {
          const { session_id, tool_use_id, content } = msg;
          try {
            await sessionManager.submitToolResult(session_id, tool_use_id, content);
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

            // Best-effort git commit — fire after cells_removed is already sent
            try {
              const commitResult = await session.gitManager.commitCellExecution(
                'edit',
                `Remove ${cell_ids.length} cell(s)`,
              );
              if (commitResult) {
                console.log(`[ws] Committed cell removal – ${commitResult.filesChanged.length} file(s) changed`);
              }
            } catch (err) {
              console.warn('[ws] Git commit for cell removal failed:', String(err));
            }
          } catch (err) {
            sendToClient(ws, { type: 'cells_remove_failed', session_id, error: String(err) });
          }
          break;
        }

        case 'watch_subscribe': {
          const { watch_id, kind, project_id, dir_path } = msg;
          // Prevent duplicate subscriptions
          if (watchSubscriptions.has(watch_id)) break;

          if (kind === 'git' && gitWatcher && project_id) {
            const project = db.getProject(project_id);
            if (!project) {
              sendToClient(ws, { type: 'error', message: `Project "${project_id}" not found for git watch.` });
              break;
            }
            const repoPath = project.path;
            const unsub = gitWatcher.subscribe(repoPath, project_id, (pid, hash) => {
              // Push git log data along with change notification
              computeGitLog(repoPath).then((logData) => {
                sendToClient(ws, { type: 'git_changed', watch_id, project_id: pid, latest_hash: hash, ...logData });
              }).catch(() => {
                // Fallback: send without commits (frontend will request)
                sendToClient(ws, { type: 'git_changed', watch_id, project_id: pid, latest_hash: hash });
              });
            });
            watchSubscriptions.set(watch_id, unsub);
          } else if (kind === 'files' && fileWatcher) {
            let watchPath: string;
            let projectPath: string | undefined;
            let subPath = '.';
            if (dir_path === '__library__') {
              watchPath = getLibraryDir();
            } else if (project_id) {
              const project = db.getProject(project_id);
              if (!project) {
                sendToClient(ws, { type: 'error', message: `Project "${project_id}" not found for file watch.` });
                break;
              }
              projectPath = project.path;
              watchPath = dir_path ? `${project.path}/${dir_path}` : project.path;
              if (dir_path) subPath = dir_path;
            } else {
              break; // No valid path to watch
            }
            const cacheKey = computeFileCacheKey({ dirPath: dir_path, projectId: project_id });
            const unsub = fileWatcher.subscribe(watchPath, (dp) => {
              // Compute file list and push via WS (skip REST round-trip)
              const listFn = projectPath
                ? computeProjectFileList(projectPath, subPath)
                : listWorkspaceFiles(watchPath, '.');

              listFn.then((result) => {
                sendToClient(ws, {
                  type: 'files_changed', watch_id, dir_path: dp,
                  ...(cacheKey ? { cache_key: cacheKey, files: result } : {}),
                });
              }).catch(() => {
                // Fallback: no data, frontend will use REST
                sendToClient(ws, { type: 'files_changed', watch_id, dir_path: dp });
              });
            });
            watchSubscriptions.set(watch_id, unsub);
          }
          break;
        }

        case 'watch_unsubscribe': {
          const { watch_id } = msg;
          const unsub = watchSubscriptions.get(watch_id);
          if (unsub) {
            unsub();
            watchSubscriptions.delete(watch_id);
          }
          break;
        }

        case 'notebook_open': {
          const { request_id, path: nbPath } = msg;
          try {
            const result = await openNotebookByPath(nbPath, db, notebookStore, sessionManager);
            const CELL_PAGE_SIZE = 5;
            const totalCells = result.notebook.cells.length;
            const paginatedNotebook = totalCells > CELL_PAGE_SIZE
              ? { ...result.notebook, cells: result.notebook.cells.slice(-CELL_PAGE_SIZE) }
              : result.notebook;
            sendToClient(ws, {
              type: 'notebook_opened',
              request_id,
              notebook_id: result.notebookId,
              notebook: paginatedNotebook,
              session_id: result.sessionId,
              workspace_dir: result.workspaceDir,
              total_cells: totalCells,
            });
          } catch (err) {
            sendToClient(ws, {
              type: 'notebook_open_error',
              request_id,
              error: String(err),
            });
          }
          break;
        }

        case 'git_log_request': {
          const { request_id, project_id, page, limit, all, stats } = msg;
          try {
            const project = db.getProject(project_id);
            if (!project) {
              sendToClient(ws, { type: 'git_log_error', request_id, error: `Project "${project_id}" not found` });
              break;
            }
            const logData = await computeGitLog(project.path, { page, limit, all, stats });
            sendToClient(ws, { type: 'git_log_response', request_id, ...logData });
          } catch (err) {
            sendToClient(ws, { type: 'git_log_error', request_id, error: String(err) });
          }
          break;
        }

        case 'git_commit_files_request': {
          const { request_id, project_id, commit } = msg;
          try {
            const project = db.getProject(project_id);
            if (!project) {
              sendToClient(ws, { type: 'git_commit_files_error', request_id, error: `Project "${project_id}" not found` });
              break;
            }
            if (!/^[a-f0-9]{7,40}$/.test(commit)) {
              sendToClient(ws, { type: 'git_commit_files_error', request_id, error: 'Invalid commit hash' });
              break;
            }
            const { stdout } = await execFileAsync(
              'git', ['diff-tree', '--no-commit-id', '-r', '--numstat', commit],
              { cwd: project.path, timeout: EXEC_TIMEOUT },
            );
            const files: { path: string; additions: number; deletions: number }[] = [];
            for (const line of stdout.split('\n')) {
              const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
              if (match) {
                files.push({
                  additions: match[1] === '-' ? 0 : parseInt(match[1], 10),
                  deletions: match[2] === '-' ? 0 : parseInt(match[2], 10),
                  path: unquoteGitPath(match[3]),
                });
              }
            }
            sendToClient(ws, { type: 'git_commit_files_response', request_id, files });
          } catch (err) {
            sendToClient(ws, { type: 'git_commit_files_error', request_id, error: String(err) });
          }
          break;
        }

        case 'git_diff_request': {
          const { request_id, project_id, commit, file } = msg;
          try {
            const project = db.getProject(project_id);
            if (!project) {
              sendToClient(ws, { type: 'git_diff_error', request_id, error: `Project "${project_id}" not found` });
              break;
            }
            if (!/^[a-f0-9]{7,40}$/.test(commit)) {
              sendToClient(ws, { type: 'git_diff_error', request_id, error: 'Invalid commit hash' });
              break;
            }
            if (file && (file.includes('..') || file.startsWith('/'))) {
              sendToClient(ws, { type: 'git_diff_error', request_id, error: 'Invalid file path' });
              break;
            }
            let args: string[];
            try {
              await execFileAsync('git', ['rev-parse', `${commit}~1`], { cwd: project.path, timeout: EXEC_TIMEOUT });
              args = ['diff', `${commit}~1`, commit];
            } catch {
              args = ['diff-tree', '-p', '--root', commit];
            }
            if (file) args.push('--', file);
            const { stdout } = await execFileAsync('git', args, { cwd: project.path, timeout: EXEC_TIMEOUT, maxBuffer: 10 * 1024 * 1024 });
            sendToClient(ws, { type: 'git_diff_response', request_id, diff: stdout });
          } catch (err) {
            sendToClient(ws, { type: 'git_diff_error', request_id, error: String(err) });
          }
          break;
        }

        default: {
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
      // Clean up all watcher subscriptions
      for (const [, unsub] of watchSubscriptions) {
        unsub();
      }
      watchSubscriptions.clear();
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
