import express from 'express';
import compression from 'compression';
import { WebSocketServer } from 'ws';
import http from 'http';
import https from 'https';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import fs from 'fs';
import { readdir, readFile } from 'fs/promises';
import { SessionManager } from './session.js';
import { NotebookStore } from './notebook-store.js';
import { NotebookDb } from './db.js';
import { createAuthRouter } from './routes/auth.js';
import { createNotebooksRouter } from './routes/notebooks.js';
import { createFilesRouter } from './routes/files.js';
import { createLibraryRouter } from './routes/library.js';
import { createSessionsRouter } from './routes/sessions.js';
import { createProjectsRouter } from './routes/projects.js';
import { createGitRouter } from './routes/git.js';
import { createPluginRouter } from './routes/plugin.js';
import { createSystemRouter } from './routes/system.js';
import commandsRouter from './routes/commands.js';
import { createTaskAutoRouter, recoverDaemons, setSessionManager } from './routes/task-auto.js';
import { setupWebSocket } from './ws-handler.js';
import { authMiddleware } from './auth.js';
import { GitWatcher, FileWatcher } from './watcher.js';

// ── App setup ────────────────────────────────────────────────────────────────

const app = express();

// In production, use HTTPS with self-signed cert; in dev, use HTTP (Vite handles HTTPS)
let server: http.Server | https.Server;
if (process.env['NODE_ENV'] === 'production') {
  const certPath = path.resolve(import.meta.dirname, '../../web/localhost.pem');
  const keyPath = path.resolve(import.meta.dirname, '../../web/localhost-key.pem');
  try {
    const cert = fs.readFileSync(certPath);
    const key = fs.readFileSync(keyPath);
    server = https.createServer({ cert, key }, app);
    console.log('[server] HTTPS enabled (production mode)');
  } catch {
    console.warn('[server] SSL certs not found, falling back to HTTP');
    server = http.createServer(app);
  }
} else {
  server = http.createServer(app);
}

const wss = new WebSocketServer({ server, maxPayload: 25 * 1024 * 1024 });

app.use(compression());
app.use(express.json());

// Build ALLOWED_ORIGINS dynamically from all network interfaces
const ALLOWED_ORIGINS = new Set([
  'https://localhost:3000',
  'http://localhost:3000',
  'https://127.0.0.1:3000',
  'http://127.0.0.1:3000',
]);
// Add all local IPs (including external) to allowed origins
for (const ifaces of Object.values(os.networkInterfaces())) {
  for (const iface of ifaces ?? []) {
    if (iface.family === 'IPv4') {
      ALLOWED_ORIGINS.add(`https://${iface.address}:3000`);
      ALLOWED_ORIGINS.add(`http://${iface.address}:3000`);
    }
  }
}
console.log('[server] Allowed origins:', [...ALLOWED_ORIGINS]);

app.use((req, res, next) => {
  const origin = req.headers['origin'] ?? '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  next();
});

app.options('/{*path}', (_req, res) => {
  res.sendStatus(204);
});

// ── Auth routes (public) ─────────────────────────────────────────────────────

app.use('/api/auth', createAuthRouter());

// ── Production: serve frontend static files (before auth) ───────────────────

if (process.env['NODE_ENV'] === 'production') {
  const webDistPath = path.resolve(import.meta.dirname, '../../web/dist');
  // Hashed assets: long cache (1 year)
  app.use('/assets', express.static(path.join(webDistPath, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }));
  // Other static files (favicon, manifest, etc.): short cache
  app.use(express.static(webDistPath, {
    maxAge: '5m',
    setHeaders(res, filePath) {
      // index.html must never be cached so new deploys take effect immediately
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));
  // SPA fallback: serve index.html for non-API routes (no-cache)
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) return next();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(webDistPath, 'index.html'));
  });
}

// Auth middleware — protects all API routes below this point.
app.use(authMiddleware);

// ── Singletons ───────────────────────────────────────────────────────────────

const sessionManager = new SessionManager();
const notebookStore = new NotebookStore();
const db = new NotebookDb();
const workspaceRoot = process.env['NB_WORKSPACES_ROOT'] ?? path.join(os.homedir(), 'nb-workspaces');

// Wire session manager to task-auto daemon for recovery signals
setSessionManager(sessionManager);

// Wire auto-save: when a cell completes, sync cell_count + updated_at to DB.
sessionManager.onAutoSave = (notebookDbId, cellCount) => {
  db.updateNotebook(notebookDbId, {
    cell_count: cellCount,
    updated_at: new Date().toISOString(),
  });
};

// Persist Claude session ID to DB for --resume after server restart.
sessionManager.onClaudeSessionId = (sessionId, claudeSessionId) => {
  db.updateClaudeSessionId(sessionId, claudeSessionId);
};

// Start process monitor to detect session/process mismatches.
sessionManager.startProcessMonitor();

// ── REST: Health ─────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── REST: Routers ────────────────────────────────────────────────────────────

app.use('/api/notebooks', createNotebooksRouter(db, sessionManager, notebookStore));
app.use('/api/notebooks', createFilesRouter(sessionManager));
app.use('/api/library', createLibraryRouter());
app.use('/api/sessions', createSessionsRouter(sessionManager, db));
app.use('/api/projects', createProjectsRouter(db, sessionManager, notebookStore, workspaceRoot));
app.use('/api/projects', createGitRouter(db));
app.use('/api/plugin', createPluginRouter());
app.use('/api/system', createSystemRouter());
app.use('/api/commands', commandsRouter);
app.use('/api/sessions', createTaskAutoRouter(db));
app.use('/api/task-auto', createTaskAutoRouter(db));

// ── Watchers (push-based change detection) ──────────────────────────────────

const gitWatcher = new GitWatcher();
const fileWatcher = new FileWatcher();

// ── WebSocket ────────────────────────────────────────────────────────────────

setupWebSocket(wss, db, sessionManager, notebookStore, gitWatcher, fileWatcher);

// ── Startup: import notebooks from disk that have no DB record ────────────────

async function importExistingNotebooks(): Promise<void> {
  let slugs: string[];
  try {
    slugs = await readdir(workspaceRoot);
  } catch {
    return;
  }

  const existingDirs = new Set(
    db.listNotebooks().map((r) => r.workspace_dir),
  );

  let imported = 0;
  for (const slug of slugs) {
    const workspaceDir = path.join(workspaceRoot, slug);
    if (existingDirs.has(workspaceDir)) continue;

    const notebookPath = path.join(workspaceDir, `${slug}.notebook.json`);
    let raw: string;
    try {
      raw = await readFile(notebookPath, 'utf-8');
    } catch {
      continue;
    }

    try {
      const nb = JSON.parse(raw) as { metadata?: { title?: string; created?: string; updated?: string } };
      const title = nb.metadata?.title ?? 'Untitled Notebook';
      const created = nb.metadata?.created ?? new Date().toISOString();
      const updated = nb.metadata?.updated ?? created;
      const cells: unknown[] = (nb as Record<string, unknown>)['cells'] as unknown[] ?? [];

      const notebookId = crypto.randomUUID();
      db.createNotebook({
        id: notebookId,
        user_id: null,
        title,
        slug,
        workspace_dir: workspaceDir,
        notebook_path: notebookPath,
        status: 'active',
        created_at: created,
        updated_at: updated,
      });
      if (cells.length > 0) {
        db.updateNotebook(notebookId, { cell_count: cells.length });
      }
      imported++;
    } catch (err) {
      console.warn(`[import] Failed to import "${slug}":`, err);
    }
  }

  if (imported > 0) {
    console.log(`[import] Imported ${imported} notebook(s) from disk.`);
  }
}

// ── Startup: rebuild sessions for recently active notebooks ────────────────────

const ACTIVE_DAYS = 7; // Rebuild sessions for notebooks opened in the last 7 days
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Cleanup stale sessions every hour

async function rebuildActiveSessions(): Promise<void> {
  const recentNotebooks = db.getRecentNotebooks(ACTIVE_DAYS);
  if (recentNotebooks.length === 0) return;

  console.log(`[startup] Rebuilding sessions for ${recentNotebooks.length} recent notebook(s)...`);
  let rebuilt = 0;
  for (const row of recentNotebooks) {
    // Skip if session already exists
    if (sessionManager.getSessionByNotebookPath(row.notebook_path)) continue;

    try {
      let notebook;
      try {
        notebook = await notebookStore.load(row.notebook_path);
      } catch {
        // Notebook file might be missing — create empty notebook
        notebook = notebookStore.createNew(row.title, row.workspace_dir);
      }

      const dbRow = db.getActiveSession(row.id);
      const resumeSessionId = dbRow?.claude_session_id ?? undefined;

      await sessionManager.reconnectSession(
        `nb-${crypto.createHash('sha1').update(row.notebook_path).digest('hex').slice(0, 8)}`,
        row.notebook_path,
        row.workspace_dir,
        notebook,
        null,
        row.id,
        undefined,
        resumeSessionId,
      );
      rebuilt++;
    } catch (err) {
      console.warn(`[startup] Failed to rebuild session for "${row.title}":`, err);
    }
  }

  if (rebuilt > 0) {
    console.log(`[startup] Rebuilt ${rebuilt} session(s) for recent notebooks.`);
  }
}

// ── Graceful shutdown (D3-1) ──────────────────────────────────────────────────

function gracefulShutdown(signal: string) {
  console.log(`[shutdown] Received ${signal}, shutting down gracefully…`);
  sessionManager.stopProcessMonitor();
  server.close(() => {
    console.log('[shutdown] HTTP server closed.');
    sessionManager.closeAllSessions().then(() => {
      console.log('[shutdown] All sessions closed.');
      db.close();
      console.log('[shutdown] Database closed.');
      process.exit(0);
    }).catch((err: unknown) => {
      console.error('[shutdown] Error closing sessions:', err);
      db.close();
      process.exit(1);
    });
  });
  // Force exit after 10s if graceful shutdown stalls
  setTimeout(() => {
    console.error('[shutdown] Forced exit after timeout.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env['PORT'] ?? 3002;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  importExistingNotebooks().catch((err) => console.error('[import] Error:', err));

  // Rebuild sessions for recently active notebooks (session persistence)
  rebuildActiveSessions().catch((err) => console.error('[startup] Error rebuilding sessions:', err));

  // Recover auto daemons from previous server session
  try {
    const recovered = recoverDaemons(db);
    if (recovered > 0) {
      console.log(`[auto] Recovered ${recovered} auto daemon(s) from previous session.`);
    }
  } catch (err) {
    console.error('[auto] Failed to recover daemons:', err);
  }

  // Periodic cleanup of stale sessions (notebooks not opened for 7+ days)
  setInterval(() => {
    try {
      const staleNotebooks = db.getStaleNotebooks(ACTIVE_DAYS);
      if (staleNotebooks.length > 0) {
        sessionManager.cleanupStaleSessions(staleNotebooks)
          .then((cleaned) => {
            if (cleaned > 0) {
              console.log(`[cleanup] Cleaned up ${cleaned} stale session(s).`);
            }
          })
          .catch((err) => console.error('[cleanup] Error cleaning sessions:', err));
      }
    } catch (err) {
      console.error('[cleanup] Error querying stale notebooks:', err);
    }
  }, CLEANUP_INTERVAL_MS).unref();
});
