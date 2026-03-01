import { Router, type IRouter, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { rm, readFile, mkdir } from 'fs/promises';
import {
  NotebookSchema,
  type Notebook,
  type NotebookListItem,
} from '@notebook-ai/shared';
import type { SessionManager } from '../session.js';
import type { NotebookDb } from '../db.js';
import { NotebookStore } from '../notebook-store.js';
import {
  titleToSlug,
  uniqueSlug,
  ensureWorkspaceDir,
  getNotebookFilePath,
  initWorkspaceMemory,
} from '../workspace.js';
import { exportToFolder } from '../export.js';
import { generateSlice } from '../slice-generator.js';

const execAsync = promisify(exec);

/**
 * Core logic for opening a notebook by path.
 * Shared by both the REST handler and the WS handler.
 */
export async function openNotebookByPath(
  nbPath: string,
  db: NotebookDb,
  notebookStore: NotebookStore,
  sessionManager: SessionManager,
): Promise<{ notebookId: string; notebook: Notebook; sessionId: string; workspaceDir: string }> {
  // Load notebook from disk
  const notebook = await notebookStore.load(nbPath);

  const cwd = path.dirname(nbPath);

  // Check if this notebook already has a DB record (by notebook_path)
  const existingRows = db.listNotebooks();
  const existingRow = existingRows.find(r => r.notebook_path === nbPath);

  let notebookId: string;

  if (existingRow) {
    notebookId = existingRow.id;
    // Reconnect or create session
    const activeSessionRow = db.getActiveSession(notebookId);
    if (activeSessionRow) {
      const result = await sessionManager.reconnectSession(
        activeSessionRow.tmux_session, nbPath, existingRow.workspace_dir,
        notebook, activeSessionRow.jsonl_path, notebookId,
      );
      return { notebookId, notebook, sessionId: result.session.id, workspaceDir: cwd };
    }
  } else {
    // Create a DB record for this notebook
    notebookId = crypto.randomUUID();
    const title = notebook.metadata.title || 'Untitled';
    const slug = path.basename(nbPath, '.notebook.json');
    const now = new Date().toISOString();
    db.createNotebook({
      id: notebookId, user_id: null, title, slug,
      workspace_dir: cwd, notebook_path: nbPath,
      status: 'active', created_at: now, updated_at: now,
    });
  }

  // Create a new session
  const session = await sessionManager.createSession(nbPath, cwd);
  session.notebook = notebook;
  session.notebookDbId = notebookId;

  db.createSessionRecord({
    id: session.id, notebook_id: notebookId,
    tmux_session: session.id, jsonl_path: null,
    cwd, status: 'active', created_at: new Date().toISOString(),
  });

  return { notebookId, notebook, sessionId: session.id, workspaceDir: cwd };
}

export function createNotebooksRouter(
  db: NotebookDb,
  sessionManager: SessionManager,
  notebookStore: NotebookStore,
): IRouter {
  const router = Router();

  const upload = multer({
    dest: path.join(os.tmpdir(), 'nb-uploads'),
    limits: { fileSize: 100 * 1024 * 1024, files: 20 },
  });

  // ── REST: Notebooks (legacy file-based) ─────────────────────────────────

  /**
   * GET /api/notebooks?dir=<directory>
   * Lists all .notebook.json files in the given directory.
   */
  router.get('/', async (req: Request, res: Response) => {
    const dir = typeof req.query['dir'] === 'string' ? req.query['dir'] : undefined;
    if (!dir) {
      res.status(400).json({ error: 'Query parameter "dir" is required.' });
      return;
    }

    try {
      const notebooks = await notebookStore.list(dir);
      res.json({ notebooks });
    } catch (err) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  /**
   * POST /api/notebooks
   * Body: { title: string; cwd: string; filePath?: string }
   * Creates a new notebook and optionally persists it to disk.
   */
  router.post('/', async (req: Request, res: Response) => {
    const { title, cwd, filePath } = req.body as {
      title?: unknown;
      cwd?: unknown;
      filePath?: unknown;
    };

    if (typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: '"title" must be a non-empty string.' });
      return;
    }
    if (typeof cwd !== 'string' || !cwd.trim()) {
      res.status(400).json({ error: '"cwd" must be a non-empty string.' });
      return;
    }

    try {
      const notebook = notebookStore.createNew(title.trim(), cwd.trim());

      let savedPath: string;
      if (typeof filePath === 'string' && filePath.trim()) {
        savedPath = filePath.trim();
      } else {
        savedPath = path.join(cwd.trim(), NotebookStore.titleToFilename(title.trim()));
      }

      await notebookStore.save(savedPath, notebook);
      res.status(201).json({ notebook, path: savedPath });
    } catch (err) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  /**
   * POST /api/notebooks/open-by-path
   * Body: { path: string }
   * Opens a notebook from an absolute file path: loads the JSON, creates/reconnects a session.
   */
  router.post('/open-by-path', async (req: Request, res: Response) => {
    const { path: nbPath } = req.body as { path?: string };
    if (!nbPath || typeof nbPath !== 'string') {
      res.status(400).json({ error: '"path" must be a non-empty string.' });
      return;
    }

    try {
      const result = await openNotebookByPath(nbPath, db, notebookStore, sessionManager);
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT') || msg.includes('not found')) {
        res.status(404).json({ error: 'Notebook file not found.' });
      } else {
        res.status(500).json({ error: 'Internal server error.' });
      }
    }
  });

  // ── REST: Notebook History (DB-backed) ───────────────────────────────────

  /**
   * GET /api/notebooks/list
   * Returns all notebooks from the DB, ordered by updated_at DESC.
   */
  router.get('/list', (_req: Request, res: Response) => {
    try {
      const rows = db.listNotebooks();
      const items: NotebookListItem[] = rows.map((row) => ({
        id: row.id,
        title: row.title,
        slug: row.slug,
        status: row.status,
        cellCount: row.cell_count,
        hasActiveSession: !!db.getActiveSession(row.id),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
      res.json({ notebooks: items });
    } catch (err) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  /**
   * POST /api/notebooks/create
   * Creates a new notebook with an isolated workspace directory.
   * Body: { title: string; userId?: string }
   */
  router.post('/create', async (req: Request, res: Response) => {
    const { title, userId } = req.body as { title?: string; userId?: string };

    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: '"title" must be a non-empty string.' });
      return;
    }

    try {
      const baseSlug = titleToSlug(title.trim());
      const slug = uniqueSlug(baseSlug, userId);
      const workspaceDir = ensureWorkspaceDir(slug, userId);
      const notebookPath = getNotebookFilePath(workspaceDir, slug);
      const notebookId = crypto.randomUUID();
      const now = new Date().toISOString();

      db.createNotebook({
        id: notebookId,
        user_id: userId ?? null,
        title: title.trim(),
        slug,
        workspace_dir: workspaceDir,
        notebook_path: notebookPath,
        status: 'active',
        created_at: now,
        updated_at: now,
      });

      const notebook = notebookStore.createNew(title.trim(), workspaceDir);
      await notebookStore.save(notebookPath, notebook);
      await initWorkspaceMemory(workspaceDir);

      const session = await sessionManager.createSession(notebookPath, workspaceDir);
      session.notebook = notebook;
      session.notebookDbId = notebookId;

      db.createSessionRecord({
        id: session.id,
        notebook_id: notebookId,
        tmux_session: session.id,
        jsonl_path: null,
        cwd: workspaceDir,
        status: 'active',
        created_at: now,
      });

      res.status(201).json({
        notebook,
        notebookId,
        sessionId: session.id,
        slug,
        workspaceDir,
      });
    } catch (err) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  /**
   * POST /api/notebooks/extract-zip
   * Accepts an exported .zip bundle and returns the notebook JSON.
   */
  router.post('/extract-zip', upload.single('file'), async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded.' });
      return;
    }

    const tmpDir = path.join(os.tmpdir(), `nb-extract-${Date.now()}`);
    try {
      await mkdir(tmpDir, { recursive: true });
      await execAsync(`unzip -q "${file.path}" -d "${tmpDir}"`);

      const { stdout } = await execAsync(
        `find "${tmpDir}" -name "notebook.json" -path "*/data/notebook.json"`,
      );
      const jsonPath = stdout.trim();
      if (!jsonPath) {
        res.status(422).json({ error: 'No data/notebook.json found in the zip.' });
        return;
      }

      const content = await readFile(jsonPath, 'utf-8');
      const notebook = JSON.parse(content) as Notebook;
      res.json(notebook);
    } catch (err) {
      res.status(500).json({ error: 'Internal server error.' });
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      await rm(file.path, { force: true }).catch(() => {});
    }
  });

  /**
   * POST /api/notebooks/:notebookId/restore
   * Restores a notebook from the DB: loads .notebook.json, reconnects or creates a session.
   */
  router.post('/:notebookId/restore', async (req: Request, res: Response) => {
    const { notebookId } = req.params as { notebookId: string };

    try {
      const row = db.getNotebook(notebookId);
      if (!row) {
        res.status(404).json({ error: `Notebook "${notebookId}" not found.` });
        return;
      }

      let notebook: Notebook;
      try {
        notebook = await notebookStore.load(row.notebook_path);
      } catch (_err: unknown) {
        notebook = notebookStore.createNew(row.title, row.workspace_dir);
        await notebookStore.save(row.notebook_path, notebook);
      }

      const activeSessionRow = db.getActiveSession(notebookId);
      const sessionName = activeSessionRow?.tmux_session;

      let sessionId: string;
      let reconnected = false;

      if (sessionName) {
        const result = await sessionManager.reconnectSession(
          sessionName,
          row.notebook_path,
          row.workspace_dir,
          notebook,
          activeSessionRow?.jsonl_path,
          notebookId,
        );
        sessionId = result.session.id;
        reconnected = result.reconnected;

        if (!reconnected) {
          db.closeSessionRecord(activeSessionRow!.id);
          db.createSessionRecord({
            id: result.session.id,
            notebook_id: notebookId,
            tmux_session: result.session.id,
            jsonl_path: null,
            cwd: row.workspace_dir,
            status: 'active',
            created_at: new Date().toISOString(),
          });
        }
      } else {
        const session = await sessionManager.createSession(row.notebook_path, row.workspace_dir);
        session.notebook = notebook;
        session.notebookDbId = notebookId;
        sessionId = session.id;

        db.createSessionRecord({
          id: session.id,
          notebook_id: notebookId,
          tmux_session: session.id,
          jsonl_path: null,
          cwd: row.workspace_dir,
          status: 'active',
          created_at: new Date().toISOString(),
        });
      }

      db.updateNotebook(notebookId, { updated_at: new Date().toISOString() });

      const CELL_PAGE_SIZE = 5;
      const totalCells = notebook.cells.length;
      const paginatedNotebook = totalCells > CELL_PAGE_SIZE
        ? { ...notebook, cells: notebook.cells.slice(-CELL_PAGE_SIZE) }
        : notebook;

      res.json({
        notebook: paginatedNotebook,
        sessionId,
        reconnected,
        notebookId,
        workspaceDir: row.workspace_dir,
        totalCells,
      });
    } catch (err) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  /**
   * PATCH /api/notebooks/:notebookId
   * Updates notebook metadata (title, etc.).
   */
  router.patch('/:notebookId', async (req: Request, res: Response) => {
    const { notebookId } = req.params as { notebookId: string };
    const { title } = req.body as { title?: string };

    try {
      const row = db.getNotebook(notebookId);
      if (!row) {
        res.status(404).json({ error: `Notebook "${notebookId}" not found.` });
        return;
      }

      const updates: Partial<{ title: string; notebook_path: string }> = {};

      if (typeof title === 'string' && title.trim()) {
        updates.title = title.trim();

        const newSlug = titleToSlug(title.trim());
        const newNotebookPath = path.join(row.workspace_dir, `${newSlug}.notebook.json`);

        if (newNotebookPath !== row.notebook_path) {
          try {
            const { rename } = await import('fs/promises');
            await rename(row.notebook_path, newNotebookPath);
            updates.notebook_path = newNotebookPath;

            const activeSessionRow = db.getActiveSession(notebookId);
            if (activeSessionRow) {
              const session = sessionManager.getSession(activeSessionRow.tmux_session);
              if (session) session.notebookPath = newNotebookPath;
            }
          } catch (err) {
            console.warn('[PATCH] Could not rename notebook file:', err);
          }
        }
      }

      const updated = db.updateNotebook(notebookId, updates);
      res.json({ notebook: updated });
    } catch (err) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  /**
   * DELETE /api/notebooks/:notebookId
   * Closes the active session, deletes workspace, removes from DB.
   */
  router.delete('/:notebookId', async (req: Request, res: Response) => {
    const { notebookId } = req.params as { notebookId: string };

    try {
      const row = db.getNotebook(notebookId);
      if (!row) {
        res.status(404).json({ error: `Notebook "${notebookId}" not found.` });
        return;
      }

      const activeSession = db.getActiveSession(notebookId);
      if (activeSession) {
        await sessionManager.closeSession(activeSession.tmux_session);
      }

      await rm(row.workspace_dir, { recursive: true, force: true });
      db.deleteNotebook(notebookId);

      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  /**
   * POST /api/notebooks/:notebookId/import-content
   * Replaces the session's in-memory notebook with the supplied JSON body.
   */
  router.post('/:notebookId/import-content', async (req: Request, res: Response) => {
    const { notebookId } = req.params as { notebookId: string };
    const parseResult = NotebookSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid notebook format.' });
      return;
    }
    const notebook = parseResult.data;

    try {
      const row = db.getNotebook(notebookId);
      if (!row) {
        res.status(404).json({ error: `Notebook "${notebookId}" not found.` });
        return;
      }

      await notebookStore.save(row.notebook_path, notebook);

      const activeSessionRow = db.getActiveSession(notebookId);
      if (activeSessionRow) {
        const session = sessionManager.getSession(activeSessionRow.tmux_session);
        if (session) session.notebook = notebook;
      }

      db.updateNotebook(notebookId, {
        cell_count: notebook.cells.length,
        updated_at: new Date().toISOString(),
      });

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  /**
   * POST /api/notebooks/:sessionId/generate-slice
   * Generates slice sections from the session's notebook.
   */
  router.post('/:sessionId/generate-slice', (_req: Request, res: Response) => {
    const { sessionId } = _req.params as { sessionId: string };

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: `Session "${sessionId}" not found.` });
      return;
    }

    try {
      const sections = generateSlice(session.notebook);

      session.notebook = {
        ...session.notebook,
        slice: {
          generated: true,
          sections,
          updated_at: new Date().toISOString(),
        },
      };

      sessionManager.broadcastToSession(sessionId, {
        type: 'slice_update',
        sections,
      });

      res.json({ sections });
    } catch (err) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  /**
   * GET /api/notebooks/:sessionId/export-zip
   * Exports the notebook as a folder bundle, zips it, and streams the zip.
   */
  router.get('/:sessionId/export-zip', async (req: Request, res: Response) => {
    const { sessionId } = req.params as { sessionId: string };

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: `Session "${sessionId}" not found.` });
      return;
    }

    const tmpBase = path.join(os.tmpdir(), `notebook-export-${Date.now()}`);

    try {
      const bundle = await exportToFolder(session.notebook, tmpBase);
      const zipPath = `${bundle.dir}.zip`;

      await execAsync(`cd "${tmpBase}" && zip -r "${zipPath}" "${path.basename(bundle.dir)}"`);

      const zipFilename = `${path.basename(bundle.dir)}.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
      res.sendFile(zipPath, async () => {
        await rm(tmpBase, { recursive: true, force: true }).catch(() => {});
        await rm(zipPath, { force: true }).catch(() => {});
      });
    } catch (err) {
      await rm(tmpBase, { recursive: true, force: true }).catch(() => {});
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  return router;
}
