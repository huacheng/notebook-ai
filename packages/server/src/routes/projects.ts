import { Router, type IRouter, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { mkdir, writeFile, copyFile, readFile, unlink, stat, rm, readdir, realpath } from 'fs/promises';
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
import { titleToSlug, initWorkspaceMemory } from '../workspace.js';
import { computeProjectFileList } from '../project-file-list.js';

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
    try {
      const { title } = req.body;
      if (!title) return res.status(400).json({ error: 'title required' });

      const slug = titleToSlug(title);
      const projectPath = path.join(workspacesRoot, slug);

      // Reject duplicate project slug
      if (existsSync(projectPath)) {
        return res.status(409).json({ error: `Project "${title}" already exists` });
      }

      const id = randomUUID();
      const now = new Date().toISOString();

      // Create directory structure
      await mkdir(path.join(projectPath, '.deliverables'), { recursive: true });
      await mkdir(path.join(projectPath, '.worktrees'), { recursive: true });

      // Write project .status.json
      await writeFile(path.join(projectPath, '.status.json'), JSON.stringify({
        id, title, status: 'active', created_at: now, updated_at: now,
      }, null, 2));

      // Create project-level .gitignore and .MEMORY.md
      await ensureLibrarySkeleton(workspacesRoot, projectPath);
      await initWorkspaceMemory(projectPath);

      // Initialize git repo
      const git = new GitManager(projectPath);
      await git.ensureRepo();

      // Save to DB
      const project = db.createProject({
        id, title, slug, path: projectPath,
        status: 'active', created_at: now, updated_at: now,
      });

      res.json(project);
    } catch (err: unknown) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // Get project
  router.get('/:projectId', (req, res) => {
    const project = db.getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'not found' });
    res.json(project);
  });

  // Rename project
  router.patch('/:projectId', (req, res) => {
    const { title } = req.body;
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title required' });
    }

    const project = db.getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'project not found' });

    const updated = db.updateProject(req.params.projectId, { title: title.trim() });
    if (!updated) {
      return res.status(500).json({ error: 'Failed to update project' });
    }

    res.json(updated);
  });

  // List notebooks within project
  router.get('/:projectId/notebooks', async (req, res) => {
    try {
      const project = db.getProject(req.params.projectId);
      if (!project) return res.status(404).json({ error: 'project not found' });

      const worktreesDir = path.join(project.path, '.worktrees');
      const notebooks: { id: string | null; name: string; path: string }[] = [];

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
            });
          }
        }
      }

      res.json({ notebooks });
    } catch (err: unknown) {
      console.error('[projects] Error listing notebooks:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // Rename notebook by path (with worktree directory and branch sync)
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

      // Resolve the full path and validate it's within the project
      const fullPath = path.isAbsolute(notebookPath)
        ? notebookPath
        : path.join(project.path, notebookPath);

      if (!fullPath.startsWith(project.path)) {
        return res.status(400).json({ error: 'Invalid path' });
      }

      // Find the .notebook.json file and its parent directory
      let notebookFilePath: string;
      let worktreeDir: string | null = null;
      const stats = await stat(fullPath).catch(() => null);
      if (!stats) {
        return res.status(404).json({ error: 'Path not found' });
      }

      if (stats.isDirectory()) {
        // Find .notebook.json in the directory
        const files = await readdir(fullPath);
        const nbFile = files.find((f) => f.endsWith('.notebook.json'));
        if (!nbFile) {
          return res.status(404).json({ error: 'No notebook found in directory' });
        }
        notebookFilePath = path.join(fullPath, nbFile);
        worktreeDir = fullPath;
      } else if (fullPath.endsWith('.notebook.json')) {
        notebookFilePath = fullPath;
        worktreeDir = path.dirname(fullPath);
      } else {
        return res.status(400).json({ error: 'Not a notebook path' });
      }

      // Look up notebook in database
      const dbNotebook = db.getNotebookByPath(notebookFilePath);

      // Compute new slug and paths
      const newSlug = titleToSlug(title.trim());
      const newNotebookFileName = `${newSlug}.notebook.json`;

      // Check if this is a worktree directory (under .worktrees/task-xxx)
      const worktreesBase = path.join(project.path, '.worktrees');
      const isWorktree = worktreeDir && worktreeDir.startsWith(worktreesBase);
      const oldWorktreeName = worktreeDir ? path.basename(worktreeDir) : null;
      const newWorktreeName = `task-${newSlug}`;

      let newWorktreeDir = worktreeDir;
      let newNotebookFilePath = path.join(worktreeDir || path.dirname(notebookFilePath), newNotebookFileName);

      // If worktree directory name changes, rename it
      if (isWorktree && oldWorktreeName && oldWorktreeName !== newWorktreeName) {
        const newWorktreePath = path.join(worktreesBase, newWorktreeName);

        // Check if target already exists
        if (existsSync(newWorktreePath)) {
          return res.status(409).json({ error: `Notebook "${title}" already exists in this project` });
        }

        // Rename worktree directory using git worktree move
        const git = new GitManager(project.path);
        await git.moveWorktree(worktreeDir!, newWorktreePath);
        newWorktreeDir = newWorktreePath;

        // Update notebook file path to new location
        newNotebookFilePath = path.join(newWorktreePath, newNotebookFileName);

        // Rename git branch if it follows task/{slug} pattern
        const oldBranchName = `task/${oldWorktreeName.replace(/^task-/, '')}`;
        const newBranchName = `task/${newSlug}`;
        try {
          await git.renameBranch(oldBranchName, newBranchName);
        } catch {
          // Branch might not exist or have different name, ignore
        }
      }

      // Rename the .notebook.json file within the (possibly moved) directory
      const currentNotebookPath = isWorktree && newWorktreeDir !== worktreeDir
        ? path.join(newWorktreeDir!, path.basename(notebookFilePath))
        : notebookFilePath;

      if (newNotebookFilePath !== currentNotebookPath) {
        const { rename } = await import('fs/promises');
        await rename(currentNotebookPath, newNotebookFilePath);
      }

      // Update database if notebook exists there
      if (dbNotebook) {
        const updates: { title: string; notebook_path: string; workspace_dir?: string; slug?: string } = {
          title: title.trim(),
          notebook_path: newNotebookFilePath,
        };
        if (isWorktree && newWorktreeDir !== worktreeDir) {
          updates.workspace_dir = newWorktreeDir!;
          updates.slug = newSlug;
        }
        db.updateNotebook(dbNotebook.id, updates);

        // Update active session if any
        const activeSession = db.getActiveSession(dbNotebook.id);
        if (activeSession) {
          const session = sessionManager.getSession(activeSession.tmux_session);
          if (session) {
            session.notebookPath = newNotebookFilePath;
            if (isWorktree && newWorktreeDir !== worktreeDir) {
              session.cwd = newWorktreeDir!;
              // Restart agentProcess to apply new system prompt with updated path
              // skipResume: true because the old session context has stale paths
              await sessionManager.restartSession(session.id, { skipResume: true });
            }
          }
        }
      }

      // Update .claude/settings.json with new absolute path for .MEMORY.md
      // This regenerates the settings file with correct paths after directory rename
      if (isWorktree && newWorktreeDir && newWorktreeDir !== worktreeDir) {
        await initWorkspaceMemory(newWorktreeDir, project.path);
      }

      res.json({ success: true, newPath: newNotebookFilePath, newWorktreeDir });
    } catch (err: unknown) {
      console.error('[projects] Error renaming notebook:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // Create notebook within project
  router.post('/:projectId/notebooks', async (req, res) => {
    try {
      const project = db.getProject(req.params.projectId);
      if (!project) return res.status(404).json({ error: 'project not found' });

      const { title } = req.body;
      if (!title) return res.status(400).json({ error: 'title required' });

      const nbSlug = titleToSlug(title);
      const branchName = `task/${nbSlug}`;
      const worktreePath = path.join(project.path, '.worktrees', `task-${nbSlug}`);

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

      // Save to DB
      const now = new Date().toISOString();
      const nbId = randomUUID();
      db.createNotebook({
        id: nbId, user_id: null, title, slug: nbSlug,
        workspace_dir: worktreePath, notebook_path: notebookPath,
        project_id: project.id,
        status: 'active', created_at: now, updated_at: now,
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
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // Dotfile visibility logic extracted to project-file-list.ts

  const upload = multer({
    dest: path.join(os.tmpdir(), 'nb-uploads'),
    limits: { fileSize: 100 * 1024 * 1024, files: 20 },
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
      // realpath may throw ENOENT for non-existent traversal targets — fallback prefix check
      const resolved = path.resolve(project.path, subPath);
      const projectRoot = path.resolve(project.path);
      if (resolved !== projectRoot && !resolved.startsWith(projectRoot + path.sep)) {
        return res.status(403).json({ error: 'path traversal' });
      }
      // Non-existent directory → empty listing
      res.json({ dirPath: resolved, files: [], truncated: false });
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

      // Read .status.json for title (fallback to filename)
      let title = '';
      const statusPath = path.join(tmpExtract, '.status.json');
      try {
        const statusData = JSON.parse(await readFile(statusPath, 'utf-8'));
        title = statusData.title || '';
      } catch (_err: unknown) { /* no .status.json or invalid */ }

      if (!title) {
        // Derive title from uploaded filename: "my-project.tar.gz" → "my-project"
        const orig = file.originalname || 'imported-project';
        title = orig.replace(/\.(tar\.gz|tgz)$/i, '');
      }

      // Create new project
      const slug = titleToSlug(title);
      const id = randomUUID();
      const now = new Date().toISOString();

      // Ensure unique directory
      let projectPath = path.join(workspacesRoot, slug);
      if (existsSync(projectPath)) {
        projectPath = path.join(workspacesRoot, `${slug}-${id.slice(0, 6)}`);
      }

      // Copy extracted files to project directory (exclude .git, .worktrees)
      await mkdir(projectPath, { recursive: true });
      await execFileAsync('rsync', [
        '-a', '--exclude', '.git', '--exclude', '.worktrees',
        tmpExtract + '/', projectPath + '/',
      ]);

      // Rewrite .status.json with new id and timestamps
      await writeFile(path.join(projectPath, '.status.json'), JSON.stringify({
        id, title, status: 'active', created_at: now, updated_at: now,
      }, null, 2));

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

      // Scan for .notebook.json files and register in DB (best-effort)
      try {
        const entries = await readdir(projectPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const subEntries = await readdir(path.join(projectPath, entry.name));
            for (const sub of subEntries) {
              if (sub.endsWith('.notebook.json')) {
                const nbPath = path.join(projectPath, entry.name, sub);
                const nbId = randomUUID();
                const nbSlug = sub.replace('.notebook.json', '');
                db.createNotebook({
                  id: nbId, user_id: null, title: nbSlug, slug: nbSlug,
                  workspace_dir: projectPath, notebook_path: nbPath,
                  project_id: id,
                  status: 'active', created_at: now, updated_at: now,
                });
              }
            }
          }
        }
      } catch (_err: unknown) { /* ignore scan errors */ }

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
      const { rm } = await import('fs/promises');
      await rm(project.path, { recursive: true, force: true }).catch(() => {});

      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  return router;
}
