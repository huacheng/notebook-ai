import { Router, type IRouter, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile, copyFile, unlink, stat, rm, readdir, realpath } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import multer from 'multer';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { NotebookDb } from '../db.js';
import type { SessionManager } from '../session.js';
import type { NotebookStore } from '../notebook-store.js';
import { GitManager } from '../git.js';
import { initTaskWorkingDir, ensureLibrarySkeleton } from '../task-init.js';
import { validateWorkspacePath } from '../workspace-files.js';
import { generateSlug, initWorkspaceMemory } from '../workspace.js';
import { computeProjectFileList } from '../project-file-list.js';
import { MAX_FILE_UPLOAD_SIZE } from '../constants.js';

const execFileAsync = promisify(execFile);

export function createProjectsRouter(
  db: NotebookDb,
  sessionManager: SessionManager,
  notebookStore: NotebookStore,
  workspacesRoot: string
): IRouter {
  const router = Router();

  // List projects (prune orphaned notebook records first)
  router.get('/', async (_req, res) => {
    await db.pruneOrphanedNotebooks();
    const projects = db.listProjects();
    res.json(projects);
  });

  // Create project
  router.post('/', async (req, res) => {
    let projectPath: string | null = null;
    let createdProjectId: string | null = null;
    try {
      const { title } = req.body;
      if (!title) return res.status(400).json({ error: 'title required' });

      const slug = generateSlug('proj');
      projectPath = path.join(workspacesRoot, slug);

      // Reject duplicate project slug
      if (existsSync(projectPath)) {
        return res.status(409).json({ error: `Project "${title}" already exists` });
      }

      const id = randomUUID();
      const now = new Date().toISOString();

      // Create directory structure
      await mkdir(path.join(projectPath, '.deliverables'), { recursive: true });
      await mkdir(path.join(projectPath, '.worktrees'), { recursive: true });

      // Create project-level .gitignore
      await ensureLibrarySkeleton(workspacesRoot, projectPath);

      // Initialize git repo
      const git = new GitManager(projectPath);
      await git.ensureRepo();

      // Save to DB
      const project = db.createProject({
        id, title, slug, path: projectPath,
        status: 'active', created_at: now, updated_at: now,
      });
      createdProjectId = id;

      // Create default notebook on project's current branch (no worktree)
      const { createDefaultNotebook } = await import('../default-notebook.js');
      const defRes = await createDefaultNotebook({ projectPath, title });
      db.createNotebook({
        id: randomUUID(),
        user_id: null,
        title,
        slug: defRes.nbSlug,
        workspace_dir: projectPath,
        notebook_path: defRes.notebookPath,
        project_id: id,
        status: 'active',
        created_at: now,
        updated_at: now,
      });
      try {
        await git.commitAll(`project(${slug}): initialize default notebook`);
      } catch { /* best-effort */ }

      res.json(project);
    } catch (err: unknown) {
      // Rollback: delete project row (if inserted) and remove directory (if created).
      // Order: DB first — the row references the path, so the row must go first to avoid
      // a window where GET /projects returns a row pointing at a directory being removed.
      if (createdProjectId) {
        try { db.deleteProject(createdProjectId); } catch { /* ignore */ }
      }
      if (projectPath && existsSync(projectPath)) {
        try {
          await rm(projectPath, { recursive: true, force: true });
        } catch { /* ignore cleanup errors */ }
      }
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // Get project
  router.get('/:projectId', (req, res) => {
    const project = db.getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'not found' });
    res.json(project);
  });

  // Rename project (title only — ASCII slug/path unchanged)
  router.patch('/:projectId', async (req, res) => {
    const { title } = req.body;
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title required' });
    }

    const project = db.getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'project not found' });

    // ASCII slug architecture: only update display title, never rename dirs
    const updated = db.updateProject(req.params.projectId, { title: title.trim() });
    if (!updated) return res.status(500).json({ error: 'Failed to update project' });

    res.json(updated);
  });

  // List notebooks within project
  router.get('/:projectId/notebooks', async (req, res) => {
    try {
      const project = db.getProject(req.params.projectId);
      if (!project) return res.status(404).json({ error: 'project not found' });

      // Scan project root for default *.notebook.json files
      const rootEntries = await readdir(project.path).catch(() => [] as string[]);
      const rootNbFiles: string[] = [];
      for (const entry of rootEntries) {
        if (!entry.endsWith('.notebook.json')) continue;
        if (entry.endsWith('.notebook.json.bak')) continue;
        try {
          const st = await stat(path.join(project.path, entry));
          if (st.isFile()) rootNbFiles.push(entry);
        } catch { /* skip */ }
      }
      rootNbFiles.sort();

      let defaultNotebook: { id: string | null; name: string; path: string; is_default: true } | null = null;
      if (rootNbFiles.length >= 1) {
        const chosen = rootNbFiles[0]!;
        const absPath = path.join(project.path, chosen);
        const dbNb = db.getNotebookByPath(absPath);
        defaultNotebook = {
          id: dbNb?.id ?? null,
          name: chosen.replace('.notebook.json', ''),
          path: absPath,
          is_default: true,
        };
        if (rootNbFiles.length > 1) {
          console.warn(`[projects] Multiple root-level notebook.json in ${project.path}; using ${chosen}, ignoring: ${rootNbFiles.slice(1).join(', ')}`);
        }
      }

      const worktreesDir = path.join(project.path, '.worktrees');
      const notebooks: { id: string | null; name: string; path: string; is_default: boolean }[] = [];

      // Check if .worktrees directory exists
      if (existsSync(worktreesDir)) {
        const entries = await readdir(worktreesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const worktreePath = path.join(worktreesDir, entry.name);
          // Find .notebook.json file in the worktree
          const worktreeFiles = await readdir(worktreePath);
          const notebookFile = worktreeFiles.find((f) => f.endsWith('.notebook.json'));

          if (notebookFile) {
            // Extract name from filename (remove .notebook.json suffix)
            const name = notebookFile.replace('.notebook.json', '');
            const notebookPath = path.join(worktreePath, notebookFile);
            // Look up notebook ID from database
            const dbNotebook = db.getNotebookByPath(notebookPath);
            notebooks.push({
              id: dbNotebook?.id ?? null,
              name,
              path: notebookPath,
              is_default: false,
            });
          }
        }
      }

      const ordered = defaultNotebook ? [defaultNotebook, ...notebooks] : notebooks;
      res.json({ notebooks: ordered });
    } catch (err: unknown) {
      console.error('[projects] Error listing notebooks:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // Rename notebook (title only — ASCII slug/path/branch unchanged)
  router.patch('/:projectId/notebooks/rename', async (req, res) => {
    try {
      const project = db.getProject(req.params.projectId);
      if (!project) return res.status(404).json({ error: 'project not found' });

      const { notebookPath, title } = req.body as { notebookPath?: string; title?: string };
      if (!notebookPath || typeof notebookPath !== 'string') {
        return res.status(400).json({ error: 'notebookPath required' });
      }
      if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'title required' });
      }

      // Resolve and validate path (D2: realpath for symlink-safe validation)
      const resolved = path.isAbsolute(notebookPath)
        ? notebookPath
        : path.join(project.path, notebookPath);
      if (!resolved.startsWith(project.path + path.sep) && resolved !== project.path) {
        return res.status(400).json({ error: 'Invalid path' });
      }
      let fullPath: string;
      try {
        const realBase = await realpath(project.path);
        const realTarget = await realpath(resolved);
        if (!realTarget.startsWith(realBase + path.sep) && realTarget !== realBase) {
          return res.status(400).json({ error: 'Invalid path' });
        }
        fullPath = realTarget;
      } catch {
        fullPath = resolved; // path doesn't exist on disk — use resolved
      }

      // Find the .notebook.json file
      let notebookFilePath: string;
      const stats = await stat(fullPath).catch(() => null);
      if (!stats) return res.status(404).json({ error: 'Path not found' });

      if (stats.isDirectory()) {
        const files = await readdir(fullPath);
        const nbFile = files.find((f) => f.endsWith('.notebook.json'));
        if (!nbFile) return res.status(404).json({ error: 'No notebook found in directory' });
        notebookFilePath = path.join(fullPath, nbFile);
      } else if (fullPath.endsWith('.notebook.json')) {
        notebookFilePath = fullPath;
      } else {
        return res.status(400).json({ error: 'Not a notebook path' });
      }

      // ASCII slug architecture: only update display title, never rename dirs/branches
      const dbNotebook = db.getNotebookByPath(notebookFilePath);
      const newTitle = title.trim();
      if (dbNotebook && newTitle !== dbNotebook.title) {
        const siblings = db.listProjectNotebooks(project.id);
        if (siblings.some((n) => n.id !== dbNotebook.id && n.title === newTitle)) {
          return res.status(409).json({ error: `Notebook with title "${newTitle}" already exists in this project` });
        }
      }
      if (dbNotebook) {
        db.updateNotebook(dbNotebook.id, { title: newTitle });
      }

      // Update metadata.title inside .notebook.json
      try {
        const nbContent = await readFile(notebookFilePath, 'utf-8');
        const nbJson = JSON.parse(nbContent);
        if (nbJson.metadata) nbJson.metadata.title = newTitle;
        else nbJson.metadata = { title: newTitle };
        await writeFile(notebookFilePath, JSON.stringify(nbJson, null, 2));
      } catch {
        // Non-fatal
      }

      res.json({ success: true, newPath: notebookFilePath });
    } catch (err: unknown) {
      console.error('[projects] Error renaming notebook:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // Create notebook within project
  router.post('/:projectId/notebooks', async (req, res) => {
    let worktreePath: string | null = null;
    let branchName: string | null = null;
    let projectPath: string | null = null;
    let sessionId: string | null = null;

    try {
      const project = db.getProject(req.params.projectId);
      if (!project) return res.status(404).json({ error: 'project not found' });

      projectPath = project.path;
      const { title } = req.body;
      if (!title) return res.status(400).json({ error: 'title required' });

      const projectNotebooks = db.listProjectNotebooks(project.id);
      if (projectNotebooks.some((n) => n.title === title)) {
        return res.status(409).json({ error: `Notebook with title "${title}" already exists in this project` });
      }

      const nbSlug = generateSlug('nb');
      branchName = `task/${nbSlug}`;
      worktreePath = path.join(project.path, '.worktrees', `task-${nbSlug}`);

      // Reject duplicate notebook slug (check worktree path, not old nbDir)
      if (existsSync(worktreePath)) {
        return res.status(409).json({ error: `Notebook "${title}" already exists in this project` });
      }

      // Create branch + worktree
      const git = new GitManager(project.path);
      await git.createBranch(branchName);
      await git.addWorktree(worktreePath, branchName);

      // Create directories inside worktree (notebook's sole home)
      await mkdir(path.join(worktreePath, '.working'), { recursive: true });
      await mkdir(path.join(worktreePath, '.deliverables'), { recursive: true });

      // Initialize task-ai working directory files (within worktree)
      await initTaskWorkingDir({ worktreePath, nbSlug, title, branchName });
      await ensureLibrarySkeleton(workspacesRoot, project.path);
      await initWorkspaceMemory(worktreePath, project.path);

      const notebook = notebookStore.createNew(title, worktreePath);
      notebook.metadata.project_id = project.id;
      notebook.metadata.worktree_path = worktreePath;
      notebook.metadata.branch = branchName;

      // notebook.json lives inside worktree (git-tracked)
      const notebookPath = path.join(worktreePath, `${nbSlug}.notebook.json`);
      await notebookStore.save(notebookPath, notebook);

      // Commit initial task files in the worktree (best-effort)
      try {
        const worktreeGit = new GitManager(worktreePath);
        await worktreeGit.commitAll(`task-ai(${nbSlug}): initialize notebook`);
      } catch (_err: unknown) { /* ignore if worktree has no changes or git fails */ }

      // Create session with worktree as cwd
      const session = await sessionManager.createSession(notebookPath, worktreePath);
      sessionId = session.id;

      // Replace session.notebook with the correct notebook (with proper title)
      // so that auto-send output is written to the correctly named file
      session.notebook = notebook;

      // Save to DB first — only fire auto-send after DB succeeds
      const now = new Date().toISOString();
      const nbId = randomUUID();
      db.createNotebook({
        id: nbId, user_id: null, title, slug: nbSlug,
        workspace_dir: worktreePath, notebook_path: notebookPath,
        project_id: project.id,
        status: 'active', created_at: now, updated_at: now,
      });

      // Auto-send '/task-ai:auto load' to initialize task context (non-blocking)
      // Only execute after DB insert succeeds to avoid orphan cell execution on rollback
      const initCellId = `cell-init-${randomUUID().slice(0, 8)}`;
      const initPrompt = '/task-ai:auto load';
      session.notebook.cells.push({
        id: initCellId,
        type: 'prompt',
        source: initPrompt,
        outputs: [],
        execution_count: 1,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      console.log(`[projects] Auto-init: pushing cell ${initCellId} to session ${session.id}, cells count: ${session.notebook.cells.length}`);
      // Fire and forget - don't await to avoid blocking the response
      sessionManager.executeCell(session.id, initCellId, initPrompt)
        .then(() => console.log(`[projects] Auto-init cell ${initCellId} started successfully`))
        .catch((err) => {
          console.error(`[projects] Auto-init cell failed for ${nbSlug}:`, err);
        });

      res.json({
        notebookId: nbId,
        sessionId: session.id,
        notebookPath,
        worktreePath,
        branch: branchName,
        taskStatus: 'draft',
      });
    } catch (err: unknown) {
      console.error('[projects] Create notebook error:', err);

      // Rollback: close session, remove worktree, delete branch
      if (sessionId) {
        try { await sessionManager.closeSession(sessionId); } catch { /* ignore */ }
      }
      if (worktreePath && existsSync(worktreePath) && projectPath) {
        try {
          const git = new GitManager(projectPath);
          await git.removeWorktree(worktreePath);
        } catch {
          // Fallback: force delete directory
          try { await rm(worktreePath, { recursive: true, force: true }); } catch { /* ignore */ }
        }
      }
      if (branchName && projectPath) {
        try {
          const git = new GitManager(projectPath);
          await git.deleteBranch(projectPath, branchName);
        } catch { /* ignore - branch may not exist */ }
      }

      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // Dotfile visibility logic extracted to project-file-list.ts

  const upload = multer({
    dest: path.join(os.tmpdir(), 'nb-uploads'),
    limits: { fileSize: MAX_FILE_UPLOAD_SIZE, files: 20 },
  });

  // List files within project directory
  router.get('/:projectId/files', async (req, res) => {
    const project = db.getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'not found' });

    const subPath = (req.query.path as string) || '.';
    try {
      const result = await computeProjectFileList(project.path, subPath);
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Path outside workspace') {
        return res.status(403).json({ error: 'path traversal' });
      }
      // Unexpected error — return empty listing
      const resolved = path.resolve(project.path, subPath);
      res.json({ dirPath: resolved, files: [], truncated: false, exists: false });
    }
  });

  // Upload files to project
  router.post(
    '/:projectId/files',
    upload.array('files', 20),
    async (req: Request, res: Response) => {
      const project = db.getProject(req.params.projectId as string);
      if (!project) { res.status(404).json({ error: 'not found' }); return; }

      const subPath = typeof req.query['path'] === 'string' ? req.query['path'] : '.';
      const uploaded = req.files as Express.Multer.File[] | undefined;
      if (!uploaded || uploaded.length === 0) {
        res.status(400).json({ error: 'No files provided.' });
        return;
      }

      const results: string[] = [];
      try {
        for (const file of uploaded) {
          const name = path.basename(file.originalname);
          const destPath = await validateWorkspacePath(path.join(subPath, name), project.path);
          await copyFile(file.path, destPath);
          await unlink(file.path).catch(() => {});
          results.push(name);
        }
        res.json({ uploaded: results });
      } catch (err: unknown) {
        for (const file of uploaded) {
          await unlink(file.path).catch(() => {});
        }
        if (err instanceof Error && err.message === 'Path outside workspace') {
          res.status(403).json({ error: 'Path outside workspace' });
        } else {
          res.status(400).json({ error: 'Upload failed.' });
        }
      }
    },
  );

  // Create empty file
  router.post('/:projectId/files/new-file', async (req, res) => {
    const project = db.getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: 'not found' }); return; }

    const subPath = typeof req.query['path'] === 'string' ? req.query['path'] : '.';
    const name = (typeof req.query['name'] === 'string' ? req.query['name'] : '').trim();
    if (!name || name.includes('/') || name === '.' || name === '..') {
      res.status(400).json({ error: 'Invalid file name.' });
      return;
    }
    try {
      const targetPath = await validateWorkspacePath(path.join(subPath, name), project.path);
      await writeFile(targetPath, '', { flag: 'wx' });
      res.json({ ok: true });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Path outside workspace') {
        res.status(403).json({ error: 'Path outside workspace' });
      } else {
        res.status(400).json({ error: 'File creation failed.' });
      }
    }
  });

  // Create directory
  router.post('/:projectId/files/mkdir', async (req, res) => {
    const project = db.getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: 'not found' }); return; }

    const subPath = typeof req.query['path'] === 'string' ? req.query['path'] : '.';
    const name = (typeof req.query['name'] === 'string' ? req.query['name'] : '').trim();
    if (!name || name.includes('/') || name === '.' || name === '..') {
      res.status(400).json({ error: 'Invalid directory name.' });
      return;
    }
    try {
      const targetPath = await validateWorkspacePath(path.join(subPath, name), project.path);
      await mkdir(targetPath);
      res.json({ ok: true });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Path outside workspace') {
        res.status(403).json({ error: 'Path outside workspace' });
      } else {
        res.status(400).json({ error: 'Directory creation failed.' });
      }
    }
  });

  // Delete file or directory
  router.delete('/:projectId/files', async (req, res) => {
    const project = db.getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: 'not found' }); return; }

    const filePath = typeof req.query['path'] === 'string' ? req.query['path'] : '';
    if (!filePath || filePath === '.') {
      res.status(400).json({ error: 'Cannot delete project root.' });
      return;
    }
    // Protect .working/ directory and its contents from deletion
    if (filePath === '.working' || filePath.startsWith('.working/')) {
      res.status(403).json({ error: 'Cannot delete .working/ system files.' });
      return;
    }
    try {
      const resolved = await validateWorkspacePath(filePath, project.path);
      await rm(resolved, { recursive: true, force: false });
      res.json({ ok: true });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Path outside workspace') {
        res.status(403).json({ error: 'Path outside workspace' });
      } else {
        res.status(400).json({ error: 'Operation failed.' });
      }
    }
  });

  // Serve file inline with correct MIME type (for markdown image embedding)
  router.get('/:projectId/files/raw', async (req, res) => {
    const project = db.getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: 'not found' }); return; }

    const filePath = typeof req.query['path'] === 'string' ? req.query['path'] : '';
    try {
      const resolved = await validateWorkspacePath(filePath, project.path);
      const fileStat = await stat(resolved);
      if (fileStat.isDirectory()) {
        res.status(400).json({ error: 'Cannot serve a directory.' });
        return;
      }
      const ext = path.extname(resolved).toLowerCase().slice(1);
      const mimeMap: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
        bmp: 'image/bmp', ico: 'image/x-icon',
      };
      const mime = mimeMap[ext] ?? 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', fileStat.size);
      res.setHeader('Cache-Control', 'private, max-age=60');
      createReadStream(resolved).pipe(res);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Path outside workspace') {
        res.status(403).json({ error: 'Path outside workspace' });
      } else {
        res.status(400).json({ error: 'File not found.' });
      }
    }
  });

  // Download single file
  router.get('/:projectId/files/download', async (req, res) => {
    const project = db.getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: 'not found' }); return; }

    const filePath = typeof req.query['path'] === 'string' ? req.query['path'] : '';
    try {
      const resolved = await validateWorkspacePath(filePath, project.path);
      const fileStat = await stat(resolved);
      if (fileStat.isDirectory()) {
        res.status(400).json({ error: 'Cannot download a directory.' });
        return;
      }
      const filename = path.basename(resolved);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Content-Length', fileStat.size);
      createReadStream(resolved).pipe(res);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Path outside workspace') {
        res.status(403).json({ error: 'Path outside workspace' });
      } else {
        res.status(400).json({ error: 'Operation failed.' });
      }
    }
  });

  // Download as tar.gz (whole project or subdirectory via ?path=)
  router.get('/:projectId/files/zip', async (req, res) => {
    const project = db.getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: 'not found' }); return; }

    const subPath = typeof req.query['path'] === 'string' ? req.query['path'] : '';

    // Determine target directory and archive filename
    let targetDir = project.path;
    let archiveName = project.slug || 'project';

    if (subPath) {
      // D2: use realpath for symlink-safe path validation
      try {
        const resolved = path.resolve(project.path, subPath);
        // Quick pre-check before realpath (catches obvious traversal even if path doesn't exist)
        if (!resolved.startsWith(project.path + path.sep) && resolved !== project.path) {
          res.status(403).json({ error: 'path traversal' });
          return;
        }
        const realProjectRoot = await realpath(project.path);
        const realResolved = await realpath(resolved);
        if (!realResolved.startsWith(realProjectRoot + path.sep) && realResolved !== realProjectRoot) {
          res.status(403).json({ error: 'path traversal' });
          return;
        }
        targetDir = realResolved;
        archiveName = path.basename(realResolved);
      } catch {
        res.status(404).json({ error: 'path not found' });
        return;
      }
    }

    const { spawn } = await import('child_process');
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${archiveName}.tar.gz"`);
    const tar = spawn('tar', ['czf', '-', '-C', targetDir, '.']);
    tar.stdout.pipe(res);
    tar.stderr.on('data', (d: Buffer) => console.error('[tar]', d.toString()));
    tar.on('error', () => { if (!res.headersSent) res.status(500).json({ error: 'Archive creation failed.' }); });
  });

  // Import project from tar.gz
  const importUpload = multer({
    dest: path.join(os.tmpdir(), 'nb-import'),
    limits: { fileSize: 500 * 1024 * 1024, files: 1 },
  });

  router.post('/import', importUpload.single('archive'), async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'No archive file provided.' }); return; }

    let tmpExtract = '';
    try {
      // Extract to temp directory
      const { mkdtemp } = await import('fs/promises');
      tmpExtract = await mkdtemp(path.join(os.tmpdir(), 'nb-import-extract-'));
      // Validate archive entries before extraction to prevent tar-slip (path traversal)
      const { stdout: listing } = await execFileAsync('tar', ['tzf', file.path], { timeout: 30_000 });
      for (const entry of listing.trim().split('\n')) {
        if (entry.includes('..') || path.isAbsolute(entry)) {
          throw new Error('Archive contains unsafe path');
        }
      }
      await execFileAsync('tar', ['xzf', file.path, '-C', tmpExtract]);

      // Derive title from uploaded filename: "my-project.tar.gz" → "my-project"
      const orig = file.originalname || 'imported-project';
      const title = orig.replace(/\.(tar\.gz|tgz)$/i, '');

      // Create new project
      const slug = generateSlug('proj');
      const id = randomUUID();
      const now = new Date().toISOString();

      const projectPath = path.join(workspacesRoot, slug);

      // Copy extracted files to project directory (exclude .git, .worktrees)
      await mkdir(projectPath, { recursive: true });
      await execFileAsync('rsync', [
        '-a', '--exclude', '.git', '--exclude', '.worktrees',
        tmpExtract + '/', projectPath + '/',
      ]);

      // Ensure .deliverables directory exists
      await mkdir(path.join(projectPath, '.deliverables'), { recursive: true });

      // Initialize fresh git repo
      const git = new GitManager(projectPath);
      await git.ensureRepo();

      // Save to DB
      const project = db.createProject({
        id, title, slug, path: projectPath,
        status: 'active', created_at: now, updated_at: now,
      });

      // Scan root for top-level *.notebook.json files (best-effort)
      try {
        const { createDefaultNotebook } = await import('../default-notebook.js');

        // Step 1: Scan project root for top-level *.notebook.json files
        const rootEntries = await readdir(projectPath).catch(() => [] as string[]);
        const rootNbFiles: string[] = [];
        for (const entry of rootEntries) {
          if (!entry.endsWith('.notebook.json') || entry.endsWith('.notebook.json.bak')) continue;
          try {
            const st = await stat(path.join(projectPath, entry));
            if (st.isFile()) rootNbFiles.push(entry);
          } catch { /* skip */ }
        }
        rootNbFiles.sort();

        // Step 2: Detect if user-authored .MEMORY.md already exists
        const hasMemory = existsSync(path.join(projectPath, '.MEMORY.md'));

        if (rootNbFiles.length === 0) {
          // Step 3: No root-level notebook.json — create default

          // Collect titles from existing .worktrees/*/*.notebook.json to avoid collision
          const usedTitles = new Set<string>();
          const worktreesDir = path.join(projectPath, '.worktrees');
          try {
            const wtEntries = await readdir(worktreesDir, { withFileTypes: true });
            for (const wt of wtEntries) {
              if (!wt.isDirectory()) continue;
              try {
                const wtFiles = await readdir(path.join(worktreesDir, wt.name));
                for (const f of wtFiles) {
                  if (!f.endsWith('.notebook.json')) continue;
                  try {
                    const raw = await readFile(path.join(worktreesDir, wt.name, f), 'utf-8');
                    const parsed = JSON.parse(raw);
                    if (parsed?.metadata?.title) usedTitles.add(parsed.metadata.title);
                  } catch { /* skip */ }
                }
              } catch { /* skip */ }
            }
          } catch { /* skip */ }

          // Determine final title (avoid collisions with worktree notebook titles)
          let finalTitle = title;
          let suffix = 2;
          while (usedTitles.has(finalTitle)) {
            finalTitle = `${title}-${suffix}`;
            suffix++;
          }

          const defRes = await createDefaultNotebook({ projectPath, title: finalTitle, skipMemoryWrite: hasMemory });
          db.createNotebook({
            id: randomUUID(), user_id: null, title: finalTitle, slug: defRes.nbSlug,
            workspace_dir: projectPath, notebook_path: defRes.notebookPath,
            project_id: id, status: 'active', created_at: now, updated_at: now,
          });
        } else {
          // Step 4: Root-level notebook.json exists — use the first as default
          const chosen = rootNbFiles[0]!;
          const chosenPath = path.join(projectPath, chosen);

          if (rootNbFiles.length > 1) {
            console.warn(`[projects/import] Multiple root-level notebook.json in ${projectPath}; using ${chosen}, ignoring: ${rootNbFiles.slice(1).join(', ')}`);
          }

          // Read title from metadata (fallback to basename-slug)
          let nbTitle = chosen.replace('.notebook.json', '');
          try {
            const raw = await readFile(chosenPath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed?.metadata?.title) nbTitle = parsed.metadata.title;
          } catch { /* fallback to slug */ }

          const nbSlug = chosen.replace('.notebook.json', '');

          // Register if not already in DB
          if (!db.getNotebookByPath(chosenPath)) {
            db.createNotebook({
              id: randomUUID(), user_id: null, title: nbTitle, slug: nbSlug,
              workspace_dir: projectPath, notebook_path: chosenPath,
              project_id: id, status: 'active', created_at: now, updated_at: now,
            });
          }

          // If user has .MEMORY.md, ensure .claude/settings.json exists without overwriting memory
          if (hasMemory) {
            await initWorkspaceMemory(projectPath, undefined, { skipClaudeSettings: false, skipMemoryWrite: true });
          }
        }

        // Step 5: Scan .worktrees/ and register worktree notebooks (skip duplicates)
        const worktreesDir = path.join(projectPath, '.worktrees');
        try {
          const wtEntries = await readdir(worktreesDir, { withFileTypes: true });
          for (const wt of wtEntries) {
            if (!wt.isDirectory()) continue;
            const wtPath = path.join(worktreesDir, wt.name);
            try {
              const wtFiles = await readdir(wtPath);
              for (const f of wtFiles) {
                if (!f.endsWith('.notebook.json') || f.endsWith('.notebook.json.bak')) continue;
                const nbPath = path.join(wtPath, f);
                if (db.getNotebookByPath(nbPath)) continue; // skip duplicates
                let nbTitle = f.replace('.notebook.json', '');
                try {
                  const raw = await readFile(nbPath, 'utf-8');
                  const parsed = JSON.parse(raw);
                  if (parsed?.metadata?.title) nbTitle = parsed.metadata.title;
                } catch { /* fallback */ }
                const nbSlug = f.replace('.notebook.json', '');
                db.createNotebook({
                  id: randomUUID(), user_id: null, title: nbTitle, slug: nbSlug,
                  workspace_dir: wtPath, notebook_path: nbPath,
                  project_id: id, status: 'active', created_at: now, updated_at: now,
                });
              }
            } catch { /* skip */ }
          }
        } catch { /* .worktrees may not exist */ }
      } catch (_err: unknown) { console.error('[projects/import] notebook scan error:', _err); }

      res.json(project);
    } catch (err: unknown) {
      res.status(500).json({ error: 'Internal server error.' });
    } finally {
      // Cleanup temp files
      await unlink(file.path).catch(() => {});
      if (tmpExtract) await rm(tmpExtract, { recursive: true, force: true }).catch(() => {});
    }
  });

  // Delete notebook by file path within project
  router.delete('/:projectId/notebooks/by-path', async (req, res) => {
    try {
      const project = db.getProject(req.params.projectId);
      if (!project) return res.status(404).json({ error: 'project not found' });

      const relPath = typeof req.query['path'] === 'string' ? req.query['path'] : '';
      if (!relPath) return res.status(400).json({ error: 'path required' });

      // D2-9: Validate relPath to prevent path traversal (quick check + realpath for symlinks)
      const resolved = path.resolve(project.path, relPath);
      if (!resolved.startsWith(project.path + path.sep) && resolved !== project.path) {
        return res.status(403).json({ error: 'Path outside workspace' });
      }
      let absPath: string;
      try {
        const realBase = await realpath(project.path);
        const realTarget = await realpath(resolved);
        if (!realTarget.startsWith(realBase + path.sep) && realTarget !== realBase) {
          return res.status(403).json({ error: 'Path outside workspace' });
        }
        absPath = realTarget;
      } catch {
        absPath = resolved; // path doesn't exist on disk yet — use resolved
      }
      let nbRow = db.getNotebookByPath(absPath);

      // Frontend sends directory path (e.g. ".worktrees/task-my-nb"), but DB stores
      // full .notebook.json path. Try multiple patterns to find the DB record.
      if (!nbRow) {
        const basename = path.basename(absPath);
        // Pattern 1: {dir}/{basename}.notebook.json (old-style dirs)
        const nbFilePath = path.join(absPath, `${basename}.notebook.json`);
        nbRow = db.getNotebookByPath(nbFilePath);
        // Pattern 2: worktree dir "task-{slug}" → file "{slug}.notebook.json"
        if (!nbRow && basename.startsWith('task-')) {
          const slug = basename.slice(5);
          nbRow = db.getNotebookByPath(path.join(absPath, `${slug}.notebook.json`));
        }
        // Pattern 3: scan directory for any .notebook.json file
        if (!nbRow && existsSync(absPath)) {
          try {
            const entries = await readdir(absPath);
            for (const entry of entries) {
              if (entry.endsWith('.notebook.json')) {
                nbRow = db.getNotebookByPath(path.join(absPath, entry));
                if (nbRow) break;
              }
            }
          } catch (_err: unknown) { /* ignore read errors */ }
        }
      }

      // Detect whether this is the default notebook (lives directly in project root)
      const { isDefaultNotebook } = await import('../default-notebook.js');
      const nbFilePath = absPath.endsWith('.notebook.json') ? absPath : null;
      const isDefault = nbFilePath !== null && isDefaultNotebook(nbFilePath, project.path);

      if (isDefault) {
        // Close active session if any
        if (nbRow) {
          const activeSession = db.getActiveSession(nbRow.id);
          if (activeSession) {
            await sessionManager.closeSession(activeSession.tmux_session);
          }
        }

        // Preserve title and created from existing notebook
        let currentTitle = project.title;
        let currentCreated: string | undefined;
        try {
          const existing = await notebookStore.load(nbFilePath);
          currentTitle = existing.metadata.title;
          currentCreated = existing.metadata.created;
        } catch {
          // If load fails, fall back to project title
        }

        // Write a fresh notebook with empty cells, preserving created timestamp
        const fresh = notebookStore.createNew(currentTitle, project.path);
        const freshWithCreated = currentCreated
          ? { ...fresh, metadata: { ...fresh.metadata, created: currentCreated } }
          : fresh;
        await notebookStore.save(nbFilePath, freshWithCreated);

        // Update DB row: keep it, just reset cell_count
        if (nbRow) {
          db.updateNotebook(nbRow.id, { cell_count: 0, updated_at: new Date().toISOString() });
        }

        return res.status(204).send();
      }

      if (nbRow) {
        // Close active session
        const activeSession = db.getActiveSession(nbRow.id);
        if (activeSession) {
          await sessionManager.closeSession(activeSession.tmux_session);
        }
        db.deleteNotebook(nbRow.id);
      }

      // Determine the notebook directory to remove from disk.
      // absPath may be the dir itself or a .notebook.json file inside it.
      const nbDir = absPath.endsWith('.notebook.json') ? path.dirname(absPath) : absPath;

      if (!nbRow && !existsSync(nbDir)) {
        return res.status(404).json({ error: 'notebook not found' });
      }

      // Remove notebook directory from disk (and git worktree if applicable)
      if (nbDir !== project.path) {
        // If it's a worktree, handle merge option and branch cleanup
        if (nbDir.includes('/.worktrees/')) {
          const git = new GitManager(project.path);
          const merge = req.query['merge'] === 'true';

          // Get branch name from worktree list
          let branchName: string | undefined;
          try {
            const worktrees = await git.listWorktrees();
            const wt = worktrees.find((w) => w.path === nbDir);
            if (wt) branchName = wt.branch;
          } catch (_err: unknown) { /* ignore */ }

          // Fallback: infer branch from directory name (task-xxx → task/xxx)
          if (!branchName) {
            const dirName = path.basename(nbDir);
            if (dirName.startsWith('task-')) {
              branchName = 'task/' + dirName.slice(5);
            }
          }

          // If merge requested and we have a branch, selectively merge .deliverables/ only
          if (merge && branchName) {
            try {
              await git.mergeDeliverables(branchName);
            } catch (mergeErr) {
              const msg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
              return res.status(409).json({ error: `Merge failed: ${msg}` });
            }
          }

          // Remove the worktree
          try {
            await git.removeWorktree(nbDir);
          } catch (_err: unknown) { /* fallback to rm below */ }

          // Delete the branch after worktree is removed
          if (branchName) {
            try {
              await git.deleteBranch(project.path, branchName);
            } catch (_err: unknown) { /* branch might not exist */ }
          }
        }
        await rm(nbDir, { recursive: true, force: true }).catch(() => {});
      }

      res.status(204).send();
    } catch (err: unknown) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // Delete project (cascades: close sessions, remove worktrees, delete from disk + DB)
  router.delete('/:projectId', async (req, res) => {
    try {
      const project = db.getProject(req.params.projectId);
      if (!project) return res.status(404).json({ error: 'not found' });

      // Close active sessions for all notebooks in this project
      const notebooks = db.listProjectNotebooks(project.id);
      for (const nb of notebooks) {
        const activeSession = db.getActiveSession(nb.id);
        if (activeSession) {
          await sessionManager.closeSession(activeSession.tmux_session);
        }
      }

      // Remove worktrees (best-effort)
      try {
        const git = new GitManager(project.path);
        const worktrees = await git.listWorktrees();
        for (const wt of worktrees) {
          if (wt.path !== project.path) {
            await git.removeWorktree(wt.path).catch(() => {});
          }
        }
      } catch (_err: unknown) { /* git repo may not exist */ }

      // Delete DB records (cascades notebooks → sessions)
      db.deleteProject(project.id);

      // Remove project directory from disk
      await rm(project.path, { recursive: true, force: true }).catch(() => {});

      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  return router;
}
