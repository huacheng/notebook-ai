import { Router, type IRouter, type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { mkdir, writeFile, copyFile, unlink, stat, rm } from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import os from 'os';
import multer from 'multer';
import type { NotebookDb } from '../db.js';
import type { SessionManager } from '../session.js';
import type { NotebookStore } from '../notebook-store.js';
import { GitManager } from '../git.js';
import { listWorkspaceFiles, validateWorkspacePath } from '../workspace-files.js';

function titleToSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'project';
}

export function createProjectsRouter(
  db: NotebookDb,
  sessionManager: SessionManager,
  notebookStore: NotebookStore,
  workspacesRoot: string
): IRouter {
  const router = Router();

  // List projects
  router.get('/', (_req, res) => {
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

      let nbSlug = titleToSlug(title);

      // Avoid slug collisions by appending a short suffix
      const { existsSync } = await import('fs');
      let nbDir = path.join(project.path, nbSlug);
      if (existsSync(nbDir)) {
        nbSlug = `${nbSlug}-${randomUUID().slice(0, 6)}`;
        nbDir = path.join(project.path, nbSlug);
      }

      const branchName = `task/${nbSlug}`;
      const worktreePath = path.join(project.path, '.worktrees', `task-${nbSlug}`);

      // Create branch + worktree
      const git = new GitManager(project.path);
      await git.createBranch(branchName);
      await git.addWorktree(worktreePath, branchName);

      // Create notebook directory: project/{slug}/
      //   {slug}.notebook.json  — notebook file
      //   .working/             — task workspace files
      await mkdir(path.join(nbDir, '.working'), { recursive: true });

      const notebook = notebookStore.createNew(title, worktreePath);
      notebook.metadata.project_id = project.id;
      notebook.metadata.worktree_path = worktreePath;
      notebook.metadata.branch = branchName;

      const notebookPath = path.join(nbDir, `${nbSlug}.notebook.json`);
      await notebookStore.save(notebookPath, notebook);

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
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dotfile whitelist for project file listing — exact matches only
  const DOTFILE_WHITELIST = new Set(['.index.json']);
  function isVisibleEntry(name: string): boolean {
    if (!name.startsWith('.')) return true;
    if (DOTFILE_WHITELIST.has(name)) return true;
    if (name.endsWith('.notebook.json')) return true;
    return false;
  }

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
      const result = await listWorkspaceFiles(project.path, subPath);
      result.files = result.files.filter(f => isVisibleEntry(f.name));
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

  // Download all as tar.gz
  router.get('/:projectId/files/zip', async (req, res) => {
    const project = db.getProject(req.params.projectId);
    if (!project) { res.status(404).json({ error: 'not found' }); return; }

    const { spawn } = await import('child_process');
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${project.slug || 'project'}.tar.gz"`);
    const tar = spawn('tar', ['czf', '-', '-C', project.path, '.']);
    tar.stdout.pipe(res);
    tar.stderr.on('data', (d: Buffer) => console.error('[tar]', d.toString()));
    tar.on('error', (err: Error) => { if (!res.headersSent) res.status(500).json({ error: String(err) }); });
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
