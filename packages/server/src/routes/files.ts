import { Router, type IRouter, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import { copyFile, unlink, stat, mkdir, writeFile, rm } from 'fs/promises';
import { createReadStream } from 'fs';
import { spawn } from 'child_process';
import type { SessionManager } from '../session.js';
import { listWorkspaceFiles, validateWorkspacePath } from '../workspace-files.js';
import { ensureLibraryDir, MEMORY_FILENAME } from '../workspace.js';

function isPathTraversal(err: unknown): boolean {
  return err instanceof Error && err.message === 'Path outside workspace';
}

/** Check if a workspace path refers to a protected system file (read-only). */
function isProtectedWorkspacePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const basename = normalized.split('/').pop() || '';
  // .MEMORY.md is protected at any level
  if (basename === MEMORY_FILENAME) return true;
  // Root-level .notebook.json files are also protected
  if (normalized.endsWith('.notebook.json') && !normalized.includes('/')) return true;
  return false;
}

export function createFilesRouter(sessionManager: SessionManager): IRouter {
  const router = Router();

  const upload = multer({
    dest: path.join(os.tmpdir(), 'nb-uploads'),
    limits: { fileSize: 100 * 1024 * 1024, files: 20 },
  });

  /**
   * GET /api/notebooks/:sessionId/files?path=<subpath>
   * Lists files in the workspace directory (or a subdirectory).
   */
  router.get('/:sessionId/files', async (req: Request, res: Response) => {
    const { sessionId } = req.params as { sessionId: string };
    const subPath = typeof req.query['path'] === 'string' ? req.query['path'] : '.';

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: `Session "${sessionId}" not found.` });
      return;
    }

    try {
      const result = await listWorkspaceFiles(session.cwd, subPath);
      res.json(result);
    } catch (err) {
      const status = isPathTraversal(err) ? 403 : 400;
      res.status(status).json({ error: isPathTraversal(err) ? 'Path outside workspace' : 'Failed to list files.' });
    }
  });

  /**
   * POST /api/notebooks/:sessionId/files
   * Uploads one or more files into the workspace (multipart/form-data, field "files").
   */
  router.post(
    '/:sessionId/files',
    upload.array('files', 20),
    async (req: Request, res: Response) => {
      const { sessionId } = req.params as { sessionId: string };
      const subPath = typeof req.query['path'] === 'string' ? req.query['path'] : '.';

      const session = sessionManager.getSession(sessionId);
      if (!session) {
        res.status(404).json({ error: `Session "${sessionId}" not found.` });
        return;
      }

      const uploaded = req.files as Express.Multer.File[] | undefined;
      if (!uploaded || uploaded.length === 0) {
        res.status(400).json({ error: 'No files provided.' });
        return;
      }

      const results: string[] = [];
      try {
        for (const file of uploaded) {
          const relativePath = path.join(subPath, path.basename(file.originalname));
          if (isProtectedWorkspacePath(relativePath)) {
            await unlink(file.path).catch(() => {});
            res.status(403).json({ error: `Cannot overwrite protected file: ${path.basename(file.originalname)}` });
            return;
          }
          const destPath = await validateWorkspacePath(relativePath, session.cwd);
          await copyFile(file.path, destPath);
          // Also copy to shared library (non-fatal).
          try {
            const libraryDir = ensureLibraryDir();
            await copyFile(file.path, path.join(libraryDir, path.basename(file.originalname)));
          } catch (_err: unknown) { /* library copy non-fatal */ }
          await unlink(file.path).catch(() => {});
          results.push(path.basename(file.originalname));
        }
        res.json({ uploaded: results });
      } catch (err) {
        for (const file of uploaded) {
          await unlink(file.path).catch(() => {});
        }
        const status = isPathTraversal(err) ? 403 : 400;
        res.status(status).json({ error: isPathTraversal(err) ? 'Path outside workspace' : 'Upload failed.' });
      }
    },
  );

  /**
   * GET /api/notebooks/:sessionId/files/download?path=<relative-path>
   * Streams a single file from the workspace as a download.
   */
  router.get('/:sessionId/files/download', async (req: Request, res: Response) => {
    const { sessionId } = req.params as { sessionId: string };
    const filePath = typeof req.query['path'] === 'string' ? req.query['path'] : '';

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: `Session "${sessionId}" not found.` });
      return;
    }

    try {
      const resolved = await validateWorkspacePath(filePath, session.cwd);
      const fileStat = await stat(resolved);
      if (fileStat.isDirectory()) {
        res.status(400).json({ error: 'Cannot download a directory. Use workspace-zip instead.' });
        return;
      }
      const filename = path.basename(resolved);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Content-Length', fileStat.size);
      createReadStream(resolved).pipe(res);
    } catch (err) {
      const status = isPathTraversal(err) ? 403 : 400;
      res.status(status).json({ error: isPathTraversal(err) ? 'Path outside workspace' : 'Download failed.' });
    }
  });

  /**
   * GET /api/notebooks/:sessionId/files/zip
   * Streams the entire workspace as a tar.gz archive.
   */
  router.get('/:sessionId/files/zip', (req: Request, res: Response) => {
    const { sessionId } = req.params as { sessionId: string };

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: `Session "${sessionId}" not found.` });
      return;
    }

    const slug = path.basename(session.cwd);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.tar.gz"`);

    const tar = spawn('tar', ['czf', '-', '-C', session.cwd, '.']);
    tar.stdout.pipe(res);
    tar.stderr.on('data', (d: Buffer) => console.error('[tar]', d.toString()));
    tar.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: 'Archive creation failed.' });
    });
  });

  /**
   * POST /api/notebooks/:sessionId/files/new-file?path=<subpath>&name=<filename>
   * Creates an empty file in the workspace.
   */
  router.post('/:sessionId/files/new-file', async (req: Request, res: Response) => {
    const { sessionId } = req.params as { sessionId: string };
    const subPath = typeof req.query['path'] === 'string' ? req.query['path'] : '.';
    const name = (typeof req.query['name'] === 'string' ? req.query['name'] : '').trim();

    if (!name || name.includes('/') || name === '.' || name === '..') {
      res.status(400).json({ error: 'Invalid file name.' });
      return;
    }

    const relativePath = path.join(subPath, name);
    if (isProtectedWorkspacePath(relativePath)) {
      res.status(403).json({ error: `Cannot create protected file name: ${name}` });
      return;
    }

    const session = sessionManager.getSession(sessionId);
    if (!session) { res.status(404).json({ error: `Session "${sessionId}" not found.` }); return; }

    try {
      const targetPath = await validateWorkspacePath(relativePath, session.cwd);
      await writeFile(targetPath, '', { flag: 'wx' });
      res.json({ ok: true });
    } catch (err) {
      const status = isPathTraversal(err) ? 403 : 400;
      res.status(status).json({ error: isPathTraversal(err) ? 'Path outside workspace' : 'File creation failed.' });
    }
  });

  /**
   * POST /api/notebooks/:sessionId/files/mkdir?path=<subpath>&name=<dirname>
   * Creates a new directory in the workspace.
   */
  router.post('/:sessionId/files/mkdir', async (req: Request, res: Response) => {
    const { sessionId } = req.params as { sessionId: string };
    const subPath = typeof req.query['path'] === 'string' ? req.query['path'] : '.';
    const name = (typeof req.query['name'] === 'string' ? req.query['name'] : '').trim();

    if (!name || name.includes('/') || name === '.' || name === '..') {
      res.status(400).json({ error: 'Invalid directory name.' });
      return;
    }

    const session = sessionManager.getSession(sessionId);
    if (!session) { res.status(404).json({ error: `Session "${sessionId}" not found.` }); return; }

    try {
      const targetPath = await validateWorkspacePath(path.join(subPath, name), session.cwd);
      await mkdir(targetPath);
      res.json({ ok: true });
    } catch (err) {
      const status = isPathTraversal(err) ? 403 : 400;
      res.status(status).json({ error: isPathTraversal(err) ? 'Path outside workspace' : 'Directory creation failed.' });
    }
  });

  /**
   * DELETE /api/notebooks/:sessionId/files?path=<relative-path>
   * Deletes a file or directory (recursively) from the workspace.
   */
  router.delete('/:sessionId/files', async (req: Request, res: Response) => {
    const { sessionId } = req.params as { sessionId: string };
    const filePath = typeof req.query['path'] === 'string' ? req.query['path'] : '';

    if (!filePath || filePath === '.') {
      res.status(400).json({ error: 'Cannot delete workspace root.' });
      return;
    }

    if (isProtectedWorkspacePath(filePath)) {
      res.status(403).json({ error: 'Cannot delete protected system file.' });
      return;
    }

    const session = sessionManager.getSession(sessionId);
    if (!session) { res.status(404).json({ error: `Session "${sessionId}" not found.` }); return; }

    try {
      const resolved = await validateWorkspacePath(filePath, session.cwd);
      await rm(resolved, { recursive: true, force: false });
      res.json({ ok: true });
    } catch (err) {
      const status = isPathTraversal(err) ? 403 : 400;
      res.status(status).json({ error: isPathTraversal(err) ? 'Path outside workspace' : 'Delete failed.' });
    }
  });

  return router;
}
