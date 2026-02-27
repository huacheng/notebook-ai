import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
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
import { setupWebSocket } from './ws-handler.js';
import { authMiddleware } from './auth.js';

// ── App setup ────────────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

const ALLOWED_ORIGINS = new Set([
  'https://localhost:3000',
  'http://localhost:3000',
  'https://127.0.0.1:3000',
  'http://127.0.0.1:3000',
]);

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

// Auth middleware — protects all routes below this point.
app.use(authMiddleware);

// ── Singletons ───────────────────────────────────────────────────────────────

const sessionManager = new SessionManager();
const notebookStore = new NotebookStore();
const db = new NotebookDb();
const workspaceRoot = process.env['NB_WORKSPACE_DIR'] ?? path.join(os.homedir(), 'nb-workspaces');

// Wire auto-save: when a cell completes, sync cell_count + updated_at to DB.
sessionManager.onAutoSave = (notebookDbId, cellCount) => {
  db.updateNotebook(notebookDbId, {
    cell_count: cellCount,
    updated_at: new Date().toISOString(),
  });
};

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

// ── WebSocket ────────────────────────────────────────────────────────────────

setupWebSocket(wss, db, sessionManager, notebookStore);

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

// ── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env['PORT'] ?? 3002;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  importExistingNotebooks().catch((err) => console.error('[import] Error:', err));
});
