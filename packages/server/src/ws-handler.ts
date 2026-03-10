import { type WebSocketServer, type WebSocket } from 'ws';
import path from 'path';
import * as lz4 from 'lz4js';

// ── Error sanitization (D2-4) ───────────────────────────────────────────────
// Patterns that indicate internal details unsafe for client exposure.
const INTERNAL_PATTERNS = [
  /\/[a-zA-Z][\w/.\-]*\.\w+/,     // file paths like /home/user/file.ts
  /at\s+\S+\s+\(/,                 // stack trace frames
  /SQLITE_/i,                      // SQLite errors
  /ENOENT|EACCES|EPERM|EISDIR/,    // Node.js fs errors
  /\bat\b.*:\d+:\d+/,              // stack line references
];

const SAFE_PATTERNS = [
  /^Session ".+" not found\.?$/,
  /not found\.?$/i,
  /outside the workspace\.?$/i,
  /already running\.?$/i,
  /not running\.?$/i,
  /^Unknown message type\.?$/,
  /^Missing required/,
  /^Invalid /,
  /^Path outside workspace/,
  /^Save path /,
];

/** Sanitize error for client — strip internal details, pass safe messages through. */
export function sanitizeErrorForClient(err: unknown): string {
  if (err == null || (typeof err !== 'string' && !(err instanceof Error))) {
    return 'An internal error occurred.';
  }
  const msg = err instanceof Error ? err.message : String(err);
  // Check for safe patterns first
  for (const pattern of SAFE_PATTERNS) {
    if (pattern.test(msg)) return msg;
  }
  // Check for internal details — redact
  for (const pattern of INTERNAL_PATTERNS) {
    if (pattern.test(msg)) {
      console.error('[ws] sanitized error:', msg);
      return 'An internal error occurred.';
    }
  }
  // No internal details detected but also not a known safe message — pass through
  // (short messages without obvious internals are likely intentional user-facing messages)
  return msg;
}
import crypto from 'crypto';
import fs from 'fs/promises';
import { createReadStream, existsSync, readFileSync } from 'fs';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import {
  WSClientMessageSchema,
  type Notebook,
} from '@notebook-ai/shared';
import type { SessionManager } from './session.js';
import { type NotebookDb, DEFAULT_ANNOTATION_MAX_AGE_DAYS } from './db.js';
import { NotebookStore } from './notebook-store.js';
import { openNotebookByPath } from './routes/notebooks.js';
import { authEnabled, consumeWsTicket } from './auth.js';
import { listWorkspaceFiles, validateWorkspacePath } from './workspace-files.js';
import { exportToHtml } from './export.js';
import { getLibraryDir } from './workspace.js';
import { unquoteGitPath } from './git-utils.js';
import type { GitWatcher, FileWatcher } from './watcher.js';
import { computeFileCacheKey, computeProjectFileList } from './project-file-list.js';
import { captureUrl } from './url-capture.js';

const execFileAsync = promisify(execFileCb);

// ── D6: Exported constants ────────────────────────────────────────────────────

/** Timeout in ms for git and other exec commands */
export const EXEC_TIMEOUT = 10000;

/** Default number of commits per page for git log pagination */
export const DEFAULT_GIT_LOG_LIMIT = 20;

/** Maximum number of concurrent devices per user */
export const MAX_DEVICES_PER_USER = 5;

/** Maximum file size (50MB) for WS file streaming */
export const MAX_WS_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Compute git log for a repo path. Shared by git_log_request handler and git_changed push.
 */
export async function computeGitLog(
  cwd: string,
  opts: { page?: number; limit?: number; all?: boolean; stats?: boolean } = {},
): Promise<{ commits: unknown[]; count: number; page: number; limit: number }> {
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

  return { commits, count: commits.length, page, limit };
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
  db.cleanupOldFileAnnotations(DEFAULT_ANNOTATION_MAX_AGE_DAYS);

  // ── Multi-device collaboration data structures ──────────────────────────────

  /** Per-user connection tracking (for 5-device limit enforcement). */
  const userConnections = new Map<string, Set<WebSocket>>();

  /** Per-session subscribers (multiple devices from same user). */
  const sessionSubscribers = new Map<string, Set<WebSocket>>();

  /** WS → userId mapping. */
  const wsUserMap = new WeakMap<WebSocket, string>();

  /** Session ownership: session_id → userId (prevents cross-user access). */
  const sessionOwningUser = new Map<string, string>();

  // ── File open subscriptions for live updates ─────────────────────────────────
  interface FileOpenClient {
    ws: WebSocket;
    sessionId: string;
    source: 'workspace' | 'library' | 'deliverables';
    projectId?: string;
    basedir: string;
    originalPath: string; // The path the client sent (relative), used for sending back updates
  }
  /** filePath → Set of clients that have this file open */
  const fileOpenSubscriptions = new Map<string, Map<string, FileOpenClient>>();
  /** filePath → unsubscribe function for FileWatcher */
  const fileWatcherUnsubscribers = new Map<string, () => void>();

  /** Push updated file content to all clients watching this file */
  async function pushFileUpdate(filePath: string): Promise<void> {
    const clients = fileOpenSubscriptions.get(filePath);
    if (!clients || clients.size === 0) return;

    try {
      const stat = await fs.stat(filePath);
      if (stat.size > MAX_WS_FILE_SIZE) return; // Skip large files

      const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
      const HTML_EXTS = new Set(['html', 'htm']);
      const TEXT_EXTS = new Set(['md', 'txt', 'json', 'yaml', 'yml', 'sh', 'py', 'js', 'ts',
        'tsx', 'jsx', 'css', 'csv', 'xml', 'toml', 'ini', 'env', 'log']);
      const BINARY_FORMAT: Record<string, string> = {
        pdf: 'pdf-binary', docx: 'docx-binary', xlsx: 'xlsx-binary', pptx: 'pptx-binary',
      };
      const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);

      let format: string;
      if (HTML_EXTS.has(ext)) format = 'html';
      else if (TEXT_EXTS.has(ext)) format = 'text';
      else if (BINARY_FORMAT[ext]) format = BINARY_FORMAT[ext];
      else if (IMAGE_EXTS.has(ext)) format = 'image';
      else {
        // Unknown extension: probe for binary content
        const probe = Buffer.alloc(8192);
        const fd = await fs.open(filePath, 'r');
        try {
          const { bytesRead } = await fd.read(probe, 0, 8192, 0);
          format = probe.subarray(0, bytesRead).includes(0) ? 'unsupported' : 'text';
        } finally {
          await fd.close();
        }
      }

      if (format === 'unsupported') return;

      const isBinary = format.endsWith('-binary') || format === 'image';
      const COMPRESS_THRESHOLD = 100 * 1024;
      const CHUNK_SIZE = 512 * 1024;
      const useCompression = stat.size >= COMPRESS_THRESHOLD;

      // Push to all clients watching this file
      for (const [, client] of clients) {
        if (client.ws.readyState !== client.ws.OPEN) continue;

        const session_id = client.sessionId;
        const clientPath = client.originalPath; // Use the path the client sent, not the resolved absolute path
        sendToClient(client.ws, { type: 'file-changed-meta', session_id, path: clientPath, mtime: stat.mtimeMs, format });

        const stream = createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
        let chunkIndex = 0;

        await new Promise<void>((resolve, reject) => {
          stream.on('data', (chunk: Buffer | string) => {
            const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            if (useCompression) {
              const compressed = Buffer.from(lz4.compress(chunkBuffer));
              sendToClient(client.ws, {
                type: 'file-changed-chunk-compressed',
                session_id,
                path: clientPath,
                data: compressed.toString('base64'),
                encoding: isBinary ? 'base64' : 'utf8',
                compression: 'lz4',
                chunk_index: chunkIndex++,
              });
            } else {
              if (isBinary) {
                sendToClient(client.ws, { type: 'file-changed-chunk', session_id, path: clientPath, data: chunkBuffer.toString('base64'), encoding: 'base64' });
              } else {
                sendToClient(client.ws, { type: 'file-changed-chunk', session_id, path: clientPath, data: chunkBuffer.toString('utf-8'), encoding: 'utf8' });
              }
            }
          });
          stream.on('end', resolve);
          stream.on('error', reject);
        });

        sendToClient(client.ws, { type: 'file-changed-end', session_id, path: clientPath, mtime: stat.mtimeMs });
      }
    } catch (err) {
      console.error('[ws] pushFileUpdate error:', err);
    }
  }

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url ?? '/', `http://localhost`);
    const ticket = url.searchParams.get('ticket') ?? undefined;

    let userId: string;

    if (authEnabled) {
      const ticketResult = ticket ? consumeWsTicket(ticket) : { valid: false };
      if (!ticketResult.valid || !ticketResult.userId) {
        sendToClient(ws, { type: 'error', message: 'Unauthorized.' });
        ws.close(4001, 'Unauthorized');
        return;
      }
      userId = ticketResult.userId;
    } else {
      // Auth disabled: use a default user ID for testing
      userId = 'default-user';
    }

    // Check device limit per user
    const existingConns = userConnections.get(userId) ?? new Set();
    if (existingConns.size >= MAX_DEVICES_PER_USER) {
      sendToClient(ws, {
        type: 'device_limit_exceeded',
        max_devices: MAX_DEVICES_PER_USER,
        message: `Maximum ${MAX_DEVICES_PER_USER} devices allowed per user.`,
      });
      ws.close(4003, 'Device limit exceeded');
      return;
    }

    // Register this connection
    existingConns.add(ws);
    userConnections.set(userId, existingConns);
    wsUserMap.set(ws, userId);

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
        // D2: Do not leak Zod schema details (field names, regex) to client
        console.warn('[ws] Invalid message:', result.error.issues.length, 'validation error(s)');
        sendToClient(ws, {
          type: 'error',
          message: `Invalid message format.`,
        });
        return;
      }

      const msg = result.data;
      const currentUserId = wsUserMap.get(ws);

      // D2: permission check — session-mutating commands must come from a user who owns the session
      function checkSessionPermission(sid: string): boolean {
        // Allow pseudo-sessions for library and project file access (no subscription required)
        if (sid === '__library__' || sid.startsWith('__project_')) {
          return true;
        }
        const owningUser = sessionOwningUser.get(sid);
        if (owningUser && owningUser !== currentUserId) {
          sendToClient(ws, { type: 'error', session_id: sid, message: 'Access denied: session belongs to another user.' });
          return false;
        }
        // Also check if this WS is subscribed to the session
        const subscribers = sessionSubscribers.get(sid);
        if (!subscribers || !subscribers.has(ws)) {
          sendToClient(ws, { type: 'error', session_id: sid, message: 'Not subscribed to this session.' });
          return false;
        }
        return true;
      }

      // D2: ownership-only check for read-only operations (cell_load)
      // Allows access without subscription to avoid race condition after page refresh
      function checkSessionOwnership(sid: string): boolean {
        if (sid === '__library__' || sid.startsWith('__project_')) {
          return true;
        }
        const owningUser = sessionOwningUser.get(sid);
        // Allow if: no owner recorded (new session) OR owner matches current user
        if (owningUser && owningUser !== currentUserId) {
          sendToClient(ws, { type: 'error', session_id: sid, message: 'Access denied: session belongs to another user.' });
          return false;
        }
        return true;
      }

      switch (msg.type) {
        case 'subscribe': {
          const { session_id } = msg;
          if (subscriptions.has(session_id)) break;

          // Check if session belongs to a different user
          const owningUser = sessionOwningUser.get(session_id);
          if (owningUser && owningUser !== currentUserId) {
            sendToClient(ws, {
              type: 'error',
              session_id,
              message: 'Access denied: session belongs to another user.',
            });
            break;
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
                  undefined, row.claude_session_id ?? undefined,
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
                    claude_session_id: null,
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

            // Track session ownership and subscribers
            if (!sessionOwningUser.has(session_id)) {
              sessionOwningUser.set(session_id, currentUserId!);
            }

            // Add to session subscribers
            let subscribers = sessionSubscribers.get(session_id);
            if (!subscribers) {
              subscribers = new Set();
              sessionSubscribers.set(session_id, subscribers);
            }
            const wasEmpty = subscribers.size === 0;
            subscribers.add(ws);

            console.log(`[ws] Client ${clientId} subscribed to session ${session_id} (${subscribers.size} device(s))`);

            // Broadcast device_connected to other subscribers
            if (!wasEmpty) {
              for (const sub of subscribers) {
                if (sub !== ws && sub.readyState === sub.OPEN) {
                  sendToClient(sub, {
                    type: 'device_connected',
                    session_id,
                    device_count: subscribers.size,
                  });
                }
              }
            }

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

            // Send notebook digest so frontend can detect stale state
            const cells = session.notebook.cells;
            sendToClient(ws, {
              type: 'notebook_digest',
              session_id,
              cell_count: cells.length,
              last_cell_id: cells.length > 0 ? cells[cells.length - 1].id : null,
            });

            // Send full notebook state so new device has complete cell content
            // (including running cell's accumulated outputs from mid-stream)
            sendToClient(ws, {
              type: 'session_state',
              session_id,
              notebook: session.notebook,
            });

          }
          break;
        }

        case 'unsubscribe': {
          const { session_id } = msg;
          const remove = subscriptions.get(session_id);
          if (remove) {
            remove();
            subscriptions.delete(session_id);

            // Remove from session subscribers
            const subscribers = sessionSubscribers.get(session_id);
            if (subscribers) {
              subscribers.delete(ws);

              // Broadcast device_disconnected to remaining subscribers
              if (subscribers.size > 0) {
                for (const sub of subscribers) {
                  if (sub.readyState === sub.OPEN) {
                    sendToClient(sub, {
                      type: 'device_disconnected',
                      session_id,
                      device_count: subscribers.size,
                    });
                  }
                }
              } else {
                // Last subscriber — clean up ownership
                sessionSubscribers.delete(session_id);
                sessionOwningUser.delete(session_id);
              }
            }

            console.log(`[ws] Client ${clientId} unsubscribed from session ${session_id}`);
          }
          break;
        }

        case 'execute_request': {
          const { session_id, cell_id, source, images } = msg;
          if (!checkSessionPermission(session_id)) break;
          try {
            await sessionManager.executeCell(session_id, cell_id, source, images);
          } catch (err) {
            sendToClient(ws, {
              type: 'error',
              session_id,
              message: sanitizeErrorForClient(err),
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
            sendToClient(ws, { type: 'error', session_id, message: sanitizeErrorForClient(err) });
          }
          break;
        }

        case 'load_notebook': {
          const { session_id } = msg;
          if (!checkSessionPermission(session_id)) break;
          const session = sessionManager.getSession(session_id);
          if (!session) {
            sendToClient(ws, { type: 'error', session_id, message: `Session "${session_id}" not found.` });
            break;
          }
          // D2: Validate path is within workspace before loading
          const safePath = await validateWorkspacePath(msg.path, session.cwd).catch(() => null);
          if (!safePath) {
            sendToClient(ws, { type: 'error', session_id, message: 'Load path is outside the workspace.' });
            break;
          }
          let notebook: Notebook;
          try {
            notebook = await notebookStore.load(safePath);
          } catch (err) {
            sendToClient(ws, { type: 'error', session_id, message: sanitizeErrorForClient(err) });
            break;
          }
          session.notebook = notebook;
          console.log(`[ws] Notebook loaded from "${safePath}"`);
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
            sendToClient(ws, { type: 'error', session_id, message: sanitizeErrorForClient(err) });
          }
          break;
        }

        case 'slide_update': {
          const { session_id } = msg;
          if (!checkSessionPermission(session_id)) break;
          const session = sessionManager.getSession(session_id);
          if (session) {
            session.notebook = {
              ...session.notebook,
              slide: {
                ...session.notebook.slide,
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
          if (!checkSessionPermission(session_id)) break;
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
          if (!checkSessionPermission(session_id)) break;
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

            // D2: reject files exceeding max size to prevent memory exhaustion
            if (stat.size > MAX_WS_FILE_SIZE) {
              sendToClient(ws, { type: 'file-open-error', session_id, error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB, max ${MAX_WS_FILE_SIZE / 1024 / 1024} MB)` });
              break;
            }

            const ext = safePath.split('.').pop()?.toLowerCase() ?? '';

            const HTML_EXTS = new Set(['html', 'htm']);
            const TEXT_EXTS = new Set(['md', 'txt', 'json', 'yaml', 'yml', 'sh', 'py', 'js', 'ts',
              'tsx', 'jsx', 'css', 'csv', 'xml', 'toml', 'ini', 'env', 'log', 'changelog']);

            const BINARY_FORMAT: Record<string, string> = {
              pdf: 'pdf-binary', docx: 'docx-binary', xlsx: 'xlsx-binary', pptx: 'pptx-binary',
            };

            const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);

            let format: string;

            if (HTML_EXTS.has(ext)) {
              format = 'html';
            } else if (TEXT_EXTS.has(ext)) {
              format = 'text';
            } else if (BINARY_FORMAT[ext]) {
              format = BINARY_FORMAT[ext];
            } else if (IMAGE_EXTS.has(ext)) {
              format = 'image';
            } else {
              // Unknown extension: probe for binary content (check first 8KB for null bytes)
              const probe = Buffer.alloc(8192);
              const fd = await fs.open(safePath, 'r');
              try {
                const { bytesRead } = await fd.read(probe, 0, 8192, 0);
                const isBinaryFile = probe.subarray(0, bytesRead).includes(0);
                format = isBinaryFile ? 'unsupported' : 'text';
              } finally {
                await fd.close();
              }
            }

            sendToClient(ws, { type: 'file-open-meta', session_id, size: stat.size, mtime: stat.mtimeMs, format });

            if (format === 'unsupported') {
              sendToClient(ws, { type: 'file-open-end', session_id, mtime: stat.mtimeMs });
              break;
            }

            const isBinary = format.endsWith('-binary') || format === 'image';

            // Use LZ4 compression for files larger than 100KB, streaming chunks
            const COMPRESS_THRESHOLD = 100 * 1024;
            const CHUNK_SIZE = 512 * 1024; // 512KB chunks for better throughput
            const useCompression = stat.size >= COMPRESS_THRESHOLD;

            const stream = createReadStream(safePath, { highWaterMark: CHUNK_SIZE });
            let chunkIndex = 0;

            await new Promise<void>((resolve, reject) => {
              stream.on('data', (chunk: Buffer | string) => {
                const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                if (useCompression) {
                  // LZ4 compress each chunk individually for streaming decompression
                  const compressed = Buffer.from(lz4.compress(chunkBuffer));
                  sendToClient(ws, {
                    type: 'file-chunk-compressed',
                    session_id,
                    data: compressed.toString('base64'),
                    encoding: isBinary ? 'base64' : 'utf8',
                    compression: 'lz4',
                    chunk_index: chunkIndex++,
                  });
                } else {
                  // Small files: no compression
                  if (isBinary) {
                    sendToClient(ws, { type: 'file-chunk', session_id, data: chunkBuffer.toString('base64'), encoding: 'base64' });
                  } else {
                    sendToClient(ws, { type: 'file-chunk', session_id, data: chunkBuffer.toString('utf-8'), encoding: 'utf8' });
                  }
                }
              });
              stream.on('end', resolve);
              stream.on('error', reject);
            });

            sendToClient(ws, { type: 'file-open-end', session_id, mtime: stat.mtimeMs });

            // Subscribe to file changes for live updates
            if (fileWatcher) {
              let clients = fileOpenSubscriptions.get(safePath);
              if (!clients) {
                clients = new Map();
                fileOpenSubscriptions.set(safePath, clients);
              }
              clients.set(clientId, { ws, sessionId: session_id, source: source as 'workspace' | 'library' | 'deliverables', projectId: project_id, basedir, originalPath: filePath });

              // Start file watcher if this is the first client
              if (!fileWatcherUnsubscribers.has(safePath)) {
                const dirPath = path.dirname(safePath);
                const unsub = fileWatcher.subscribe(dirPath, async () => {
                  // Check if this specific file changed
                  try {
                    await fs.access(safePath);
                    await pushFileUpdate(safePath);
                  } catch {
                    // File deleted - notify clients and cleanup annotations
                    const fileClients = fileOpenSubscriptions.get(safePath);
                    if (fileClients) {
                      for (const [, client] of fileClients) {
                        sendToClient(client.ws, { type: 'file-deleted', session_id: client.sessionId, path: client.originalPath });
                        // D1: cleanup orphaned annotations when file is deleted
                        db.deleteFileAnnotations(client.sessionId, client.originalPath);
                      }
                    }
                  }
                });
                fileWatcherUnsubscribers.set(safePath, unsub);
              }
            }
          } catch (err) {
            sendToClient(ws, { type: 'file-open-error', session_id, error: sanitizeErrorForClient(err) });
          }
          break;
        }

        case 'file-save': {
          const { session_id, path: filePath, source, content, project_id } = msg;
          if (!checkSessionPermission(session_id)) break;
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
            sendToClient(ws, { type: 'file-save-error', session_id, error: sanitizeErrorForClient(err) });
          }
          break;
        }

        case 'annotation-load': {
          const { session_id, path: filePath } = msg;
          if (!checkSessionPermission(session_id)) break;
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
          if (!checkSessionPermission(session_id)) break;
          db.upsertFileAnnotations(session_id, filePath, content, updated_at);
          sendToClient(ws, { type: 'annotation-sync-ok', session_id, path: filePath, updated_at });
          break;
        }

        case 'notebook_sync_request': {
          const { session_id } = msg;
          if (!checkSessionPermission(session_id)) break;
          const syncSession = sessionManager.getSession(session_id);
          if (syncSession) {
            const syncJson = JSON.stringify(syncSession.notebook);
            const syncCompressed = Buffer.from(lz4.compress(Buffer.from(syncJson, 'utf-8')));
            sendToClient(ws, {
              type: 'notebook_sync',
              session_id,
              notebook_compressed: syncCompressed.toString('base64'),
              compression: 'lz4',
            });
          }
          break;
        }

        case 'restart_session': {
          const { session_id, clear } = msg;
          if (!checkSessionPermission(session_id)) break;
          try {
            // clear: true → skipResume: true (truly clears Claude context)
            await sessionManager.restartSession(session_id, clear ? { skipResume: true } : undefined);
            sendToClient(ws, { type: 'session_restarted', session_id, cleared: !!clear });
          } catch (err) {
            sendToClient(ws, { type: 'session_restart_failed', session_id, error: sanitizeErrorForClient(err) });
          }
          break;
        }

        case 'rerun_notebook': {
          const { session_id } = msg;
          if (!checkSessionPermission(session_id)) break;
          try {
            await sessionManager.rerunNotebook(session_id);
            sendToClient(ws, { type: 'rerun_started', session_id });
          } catch (err) {
            sendToClient(ws, { type: 'rerun_failed', session_id, error: sanitizeErrorForClient(err) });
          }
          break;
        }

        case 'interrupt_cell': {
          const { session_id } = msg;
          if (!checkSessionPermission(session_id)) break;
          try {
            await sessionManager.interruptCell(session_id);
            sendToClient(ws, { type: 'cell_interrupted', session_id });
          } catch (err) {
            sendToClient(ws, { type: 'error', session_id, message: sanitizeErrorForClient(err) });
          }
          break;
        }

        case 'timer_start': {
          const { session_id, interval_ms } = msg;
          if (!checkSessionPermission(session_id)) break;
          try {
            sessionManager.startTimerMode(session_id, interval_ms);
            sessionManager.broadcastToSession(session_id, { type: 'timer_started', session_id, interval_ms: interval_ms ?? null });
          } catch (err) {
            sendToClient(ws, { type: 'error', session_id, message: sanitizeErrorForClient(err) });
          }
          break;
        }

        case 'timer_stop': {
          const { session_id } = msg;
          if (!checkSessionPermission(session_id)) break;
          try {
            sessionManager.stopTimerMode(session_id);
            sendToClient(ws, { type: 'timer_stopped_ack', session_id });
          } catch (err) {
            sendToClient(ws, { type: 'error', session_id, message: sanitizeErrorForClient(err) });
          }
          break;
        }

        case 'tool_result_response': {
          const { session_id, tool_use_id, content } = msg;
          if (!checkSessionPermission(session_id)) break;
          try {
            await sessionManager.submitToolResult(session_id, tool_use_id, content);
          } catch (err) {
            sendToClient(ws, { type: 'error', session_id, message: sanitizeErrorForClient(err) });
          }
          break;
        }

        // Update tool result in notebook only (does NOT send to Claude CLI)
        // Used for AskUserQuestion workaround: persist user choice without re-sending
        case 'update_tool_result' as any: {
          const { session_id, cell_id, tool_use_id, content } = msg as any;
          if (!checkSessionPermission(session_id)) break;
          try {
            await sessionManager.updateToolResultLocal(session_id, cell_id, tool_use_id, content);
            // Broadcast to other clients so they see the update
            sessionManager.broadcastToSession(session_id, { type: 'tool_result', cell_id, tool_use_id, content, is_error: false });
          } catch (err) {
            sendToClient(ws, { type: 'error', session_id, message: sanitizeErrorForClient(err) });
          }
          break;
        }

        case 'change_model': {
          const { session_id, model } = msg;
          if (!checkSessionPermission(session_id)) break;
          try {
            await sessionManager.changeModel(session_id, model);
            sendToClient(ws, { type: 'model_changed', session_id, model });
          } catch (err) {
            sendToClient(ws, { type: 'error', session_id, message: sanitizeErrorForClient(err) });
          }
          break;
        }

        case 'url_capture': {
          const { session_id, url } = msg;
          if (!checkSessionPermission(session_id)) break;
          const session = sessionManager.getSession(session_id);
          if (!session) {
            sendToClient(ws, { type: 'url_capture_result', url, file_path: '', format: 'image' as const, error: 'Session not found' });
            break;
          }
          try {
            const filePath = await captureUrl(url, session.cwd);
            sendToClient(ws, { type: 'url_capture_result', url, file_path: filePath, format: 'image' as const });
          } catch (err) {
            sendToClient(ws, { type: 'url_capture_result', url, file_path: '', format: 'image' as const, error: sanitizeErrorForClient(err) });
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
          // Use LZ4 compression for cells_loaded (same as notebook_opened)
          const cellsJson = JSON.stringify(cells);
          const compressed = Buffer.from(lz4.compress(Buffer.from(cellsJson, 'utf-8')));
          sendToClient(ws, {
            type: 'cells_loaded',
            session_id,
            cells_compressed: compressed.toString('base64'),
            compression: 'lz4',
            offset,
            count: cells.length,
          });
          break;
        }

        case 'remove_cells': {
          const { session_id, cell_ids } = msg;
          if (!checkSessionPermission(session_id)) break;
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
            // Broadcast to all subscribers for multi-device sync
            sessionManager.broadcastToSession(session_id, { type: 'cells_removed', session_id, cell_ids });

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
            sendToClient(ws, { type: 'cells_remove_failed', session_id, error: sanitizeErrorForClient(err) });
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
              if (dir_path) {
                // D2-8: Validate dir_path to prevent path traversal
                const resolved = path.resolve(project.path, dir_path);
                if (!resolved.startsWith(project.path + path.sep) && resolved !== project.path) {
                  sendToClient(ws, { type: 'error', message: 'Path outside workspace.' });
                  break;
                }
                watchPath = resolved;
                subPath = dir_path;
              } else {
                watchPath = project.path;
              }
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

        // Task lifecycle status: watch .status.json for changes and push updates
        case 'task_status_subscribe': {
          const sessionId = msg.session_id;
          if (!checkSessionPermission(sessionId)) break;
          const session = sessionManager.getSession(sessionId);
          if (!session) break;
          if (!fileWatcher) break;

          // Resolve .status.json path: cwd/.working/.status.json or cwd/.status.json
          const cwd = session.cwd;
          let statusDir: string;
          let statusPath: string;
          if (path.basename(cwd) === '.working') {
            statusDir = cwd;
            statusPath = path.join(cwd, '.status.json');
          } else {
            const workingDir = path.join(cwd, '.working');
            if (existsSync(workingDir)) {
              statusDir = workingDir;
              statusPath = path.join(workingDir, '.status.json');
            } else {
              statusDir = cwd;
              statusPath = path.join(cwd, '.status.json');
            }
          }

          // Prevent duplicate subscriptions
          const prevStatusUnsub = watchSubscriptions.get(`task_status:${sessionId}`);
          if (prevStatusUnsub) prevStatusUnsub();

          // Watch the directory for .status.json changes
          const statusUnsub = fileWatcher.subscribe(statusDir, () => {
            try {
              if (!existsSync(statusPath)) {
                sendToClient(ws, {
                  type: 'task_status',
                  session_id: sessionId,
                  status: null,
                });
                return;
              }
              const raw = JSON.parse(readFileSync(statusPath, 'utf-8'));
              sendToClient(ws, {
                type: 'task_status',
                session_id: sessionId,
                status: raw,
              });
            } catch {
              // Ignore parse errors (partial writes)
            }
          });
          watchSubscriptions.set(`task_status:${sessionId}`, statusUnsub);

          // Send initial status if file exists
          try {
            if (existsSync(statusPath)) {
              const raw = JSON.parse(readFileSync(statusPath, 'utf-8'));
              sendToClient(ws, {
                type: 'task_status',
                session_id: sessionId,
                status: raw,
              });
            }
          } catch { /* ignore */ }
          // Cleanup handled by global ws close handler (watchSubscriptions.clear)
          break;
        }

        case 'notebook_open': {
          const { request_id, path: nbPath, lazy } = msg;
          try {
            const result = await openNotebookByPath(nbPath, db, notebookStore, sessionManager);
            const totalCells = result.notebook.cells.length;

            if (lazy) {
              // Lazy mode: send metadata + cell stubs only (no full outputs)
              const cellStubs = result.notebook.cells.map((cell: { id: string; type: string; source?: string; outputs?: unknown[]; status?: string }) => ({
                id: cell.id,
                type: cell.type,
                source_preview: (cell.source ?? '').slice(0, 200),
                output_count: cell.outputs?.length ?? 0,
                status: cell.status ?? 'complete',
              }));
              // Store notebook in session for later cell_load requests
              const session = sessionManager.getSession(result.sessionId);
              if (session) {
                session.notebook = result.notebook;
              }
              sendToClient(ws, {
                type: 'notebook_opened',
                request_id,
                notebook_id: result.notebookId,
                metadata: result.notebook.metadata,
                cell_stubs: cellStubs,
                session_id: result.sessionId,
                workspace_dir: result.workspaceDir,
                total_cells: totalCells,
                lazy: true,
              });
            } else {
              // Non-lazy mode: send paginated cells with LZ4 compression
              const CELL_PAGE_SIZE = 2;
              const paginatedNotebook = totalCells > CELL_PAGE_SIZE
                ? { ...result.notebook, cells: result.notebook.cells.slice(-CELL_PAGE_SIZE) }
                : result.notebook;
              const notebookJson = JSON.stringify(paginatedNotebook);
              const compressed = Buffer.from(lz4.compress(Buffer.from(notebookJson, 'utf-8')));
              sendToClient(ws, {
                type: 'notebook_opened',
                request_id,
                notebook_id: result.notebookId,
                notebook_compressed: compressed.toString('base64'),
                compression: 'lz4',
                session_id: result.sessionId,
                workspace_dir: result.workspaceDir,
                total_cells: totalCells,
              });
            }
          } catch (err) {
            sendToClient(ws, {
              type: 'notebook_open_error',
              request_id,
              error: sanitizeErrorForClient(err),
            });
          }
          break;
        }

        case 'cell_load': {
          const { request_id, session_id, cell_id } = msg;
          // Use ownership check (not subscription check) to avoid race condition after page refresh
          // cell_load is read-only, so subscription is not required for security
          if (!checkSessionOwnership(session_id)) break;
          try {
            const session = sessionManager.getSession(session_id);
            if (!session || !session.notebook) {
              sendToClient(ws, {
                type: 'cell_load_error',
                request_id,
                cell_id,
                error: 'Session or notebook not found',
              });
              break;
            }
            const cell = session.notebook.cells.find((c: { id: string }) => c.id === cell_id);
            if (!cell) {
              sendToClient(ws, {
                type: 'cell_load_error',
                request_id,
                cell_id,
                error: 'Cell not found',
              });
              break;
            }
            // Compress cell with LZ4 for fast transfer
            const cellJson = JSON.stringify(cell);
            const cellBuffer = Buffer.from(cellJson, 'utf-8');
            const compressed = Buffer.from(lz4.compress(cellBuffer));
            sendToClient(ws, {
              type: 'cell_loaded',
              request_id,
              session_id, // D1: Include session_id for client-side verification
              cell_id,
              cell_compressed: compressed.toString('base64'),
              compression: 'lz4',
            });
          } catch (err) {
            sendToClient(ws, {
              type: 'cell_load_error',
              request_id,
              cell_id,
              error: sanitizeErrorForClient(err),
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
            sendToClient(ws, { type: 'git_log_error', request_id, error: sanitizeErrorForClient(err) });
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
            sendToClient(ws, { type: 'git_commit_files_error', request_id, error: sanitizeErrorForClient(err) });
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
            if (file) {
              await validateWorkspacePath(file, project.path);
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
            sendToClient(ws, { type: 'git_diff_error', request_id, error: sanitizeErrorForClient(err) });
          }
          break;
        }

        // ─── Prompt Queue ───────────────────────────────────────────────────────

        case 'append_prompt': {
          const { session_id, cell_id, source, images } = msg;
          if (!checkSessionPermission(session_id)) break;
          try {
            sessionManager.appendPrompt(session_id, cell_id, source, images);
          } catch (err) {
            sendToClient(ws, { type: 'error', session_id, message: sanitizeErrorForClient(err) });
          }
          break;
        }

        default: {
          sendToClient(ws, { type: 'error', message: 'Unknown message type.' });
          break;
        }
      }
    });

    let cleanedUp = false;
    function cleanup() {
      if (cleanedUp) return; // guard against double-cleanup
      cleanedUp = true;

      // Remove from user connections
      const connUserId = wsUserMap.get(ws);
      if (connUserId) {
        const conns = userConnections.get(connUserId);
        if (conns) {
          conns.delete(ws);
          if (conns.size === 0) {
            userConnections.delete(connUserId);
          }
        }
      }

      // Remove from session subscriptions and broadcast device_disconnected
      for (const [session_id, remove] of subscriptions.entries()) {
        try { remove(); } catch (e) { console.error('[ws] cleanup: session listener removal failed:', e); }

        const subscribers = sessionSubscribers.get(session_id);
        if (subscribers) {
          subscribers.delete(ws);

          // Broadcast device_disconnected to remaining subscribers
          if (subscribers.size > 0) {
            for (const sub of subscribers) {
              if (sub.readyState === sub.OPEN) {
                sendToClient(sub, {
                  type: 'device_disconnected',
                  session_id,
                  device_count: subscribers.size,
                });
              }
            }
          } else {
            // Last subscriber — clean up ownership
            sessionSubscribers.delete(session_id);
            sessionOwningUser.delete(session_id);
          }
        }
      }
      subscriptions.clear();

      // Clean up all watcher subscriptions
      for (const [, unsub] of watchSubscriptions) {
        try { unsub(); } catch (e) { console.error('[ws] cleanup: watcher unsub failed:', e); }
      }
      watchSubscriptions.clear();

      // Clean up file open subscriptions
      for (const [filePath, clients] of fileOpenSubscriptions) {
        clients.delete(clientId);
        if (clients.size === 0) {
          fileOpenSubscriptions.delete(filePath);
          // Stop file watcher if no clients left
          const unsub = fileWatcherUnsubscribers.get(filePath);
          if (unsub) {
            try { unsub(); } catch (e) { console.error('[ws] cleanup: file watcher unsub failed:', e); }
            fileWatcherUnsubscribers.delete(filePath);
          }
        }
      }
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
