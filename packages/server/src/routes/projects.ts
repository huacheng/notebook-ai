import { Router, type IRouter, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { mkdir, writeFile, copyFile, readFile, unlink, stat, rm, readdir } from 'fs/promises';
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

      // Write project .index.json
      await writeFile(path.join(projectPath, '.index.json'), JSON.stringify({
        id, title, status: 'active', created_at: now, updated_at: now,
      }, null, 2));

      // Initialize git repo
      const git = new GitManager(projectPath);
      await git.ensureRepo();

      // Save to DB
      const project = db.createProject({
        id, title, slug, path: projectPath,
        status: 'active', created_at: now, updated_at: now,
      });

      res.json(project);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get project
  router.get('/:projectId', (req, res) => {
    const project = db.getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'not found' });
    res.json(project);
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
      } catch { /* ignore if worktree has no changes or git fails */ }

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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
    } catch (err: any) {
      if (err.message === 'Path outside workspace') {
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
      } catch (err: any) {
        for (const file of uploaded) {
          await unlink(file.path).catch(() => {});
        }
        if (err.message === 'Path outside workspace') {
          res.status(400).json({ error: 'path traversal' });
        } else {
          res.status(400).json({ error: String(err) });
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
    } catch (err) {
      res.status(400).json({ error: String(err) });
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
    } catch (err) {
      res.status(400).json({ error: String(err) });
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
    } catch (err: any) {
      if (err.message === 'Path outside workspace') {
        res.status(400).json({ error: 'path traversal' });
      } else {
        res.status(400).json({ error: String(err) });
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
    } catch (err: any) {
      if (err.message === 'Path outside workspace') {
        res.status(400).json({ error: 'path traversal' });
      } else {
        res.status(400).json({ error: String(err) });
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
      const resolved = path.resolve(project.path, subPath);
      const projectRoot = path.resolve(project.path);
      if (!resolved.startsWith(projectRoot + path.sep) && resolved !== projectRoot) {
        res.status(403).json({ error: 'path traversal' });
        return;
      }
      targetDir = resolved;
      archiveName = path.basename(resolved);
    }

    const { spawn } = await import('child_process');
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${archiveName}.tar.gz"`);
    const tar = spawn('tar', ['czf', '-', '-C', targetDir, '.']);
    tar.stdout.pipe(res);
    tar.stderr.on('data', (d: Buffer) => console.error('[tar]', d.toString()));
    tar.on('error', (err: Error) => { if (!res.headersSent) res.status(500).json({ error: String(err) }); });
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
      await execFileAsync('tar', ['xzf', file.path, '-C', tmpExtract]);

      // Read .index.json for title (fallback to filename)
      let title = '';
      const indexPath = path.join(tmpExtract, '.index.json');
      try {
        const indexData = JSON.parse(await readFile(indexPath, 'utf-8'));
        title = indexData.title || '';
      } catch { /* no .index.json or invalid */ }

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

      // Rewrite .index.json with new id and timestamps
      await writeFile(path.join(projectPath, '.index.json'), JSON.stringify({
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
      } catch { /* ignore scan errors */ }

      res.json(project);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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

      const absPath = path.join(project.path, relPath);
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
          } catch { /* ignore read errors */ }
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
        // If it's a worktree, remove via git first (cleans up .git/worktrees/ ref)
        if (nbDir.includes('/.worktrees/')) {
          try {
            const git = new GitManager(project.path);
            await git.removeWorktree(nbDir);
          } catch { /* fallback to rm below */ }
        }
        await rm(nbDir, { recursive: true, force: true }).catch(() => {});
      }

      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
      } catch { /* git repo may not exist */ }

      // Delete DB records (cascades notebooks → sessions)
      db.deleteProject(project.id);

      // Remove project directory from disk
      const { rm } = await import('fs/promises');
      await rm(project.path, { recursive: true, force: true }).catch(() => {});

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
