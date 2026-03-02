import { Router, type IRouter, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import { copyFile, unlink, stat, rm, writeFile, mkdir } from 'fs/promises';
import { createReadStream } from 'fs';
import { ensureLibraryDir } from '../workspace.js';
import { listWorkspaceFiles, validateWorkspacePath } from '../workspace-files.js';

/** Check if a library path refers to a system-predefined entry that must not be deleted. */
function isProtectedLibraryPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const firstSegment = normalized.split('/')[0];
  // Root-level dot-prefixed entries (.memory/, .changelog, .master-index.md, etc.)
  if (firstSegment.startsWith('.')) return true;
  // MEMORY.md at root
  if (normalized === 'MEMORY.md') return true;
  return false;
}

export function createLibraryRouter(): IRouter {
  const router = Router();

  const upload = multer({
    dest: path.join(os.tmpdir(), 'nb-uploads'),
    limits: { fileSize: 100 * 1024 * 1024, files: 20 },
  });

  /**
   * GET /api/library/files?path=<subpath>
   * Lists files in the library directory (or a subdirectory).
   */
  router.get('/files', async (req: Request, res: Response) => {
    const subPath = typeof req.query['path'] === 'string' ? req.query['path'] : '.';
    try {
      const libraryDir = ensureLibraryDir();
      const result = await listWorkspaceFiles(libraryDir, subPath);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: 'File listing failed.' });
    }
  });

  /**
   * POST /api/library/files?path=<subpath>
   * Uploads files to the library (optionally into a subdirectory).
   */
  router.post(
    '/files',
    upload.array('files', 20),
    async (req: Request, res: Response) => {
      const subPath = typeof req.query['path'] === 'string' ? req.query['path'] : '.';
      const uploaded = req.files as Express.Multer.File[] | undefined;
      if (!uploaded || uploaded.length === 0) {
        res.status(400).json({ error: 'No files provided.' });
        return;
      }

      const results: string[] = [];
      try {
        const libraryDir = ensureLibraryDir();
        for (const file of uploaded) {
          const name = path.basename(file.originalname);
          const destPath = await validateWorkspacePath(path.join(subPath, name), libraryDir);
          await copyFile(file.path, destPath);
          await unlink(file.path).catch(() => {});
          results.push(name);
        }
        res.json({ uploaded: results });
      } catch (err) {
        for (const file of uploaded) {
          await unlink(file.path).catch(() => {});
        }
        res.status(400).json({ error: 'Operation failed.' });
      }
    },
  );

  /**
   * GET /api/library/files/zip
   * Streams the entire library as a tar.gz archive.
   */
  router.get('/files/zip', (_req: Request, res: Response) => {
    const { spawn } = require('child_process') as typeof import('child_process');
    const libraryDir = ensureLibraryDir();
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', 'attachment; filename="library.tar.gz"');
    const tar = spawn('tar', ['czf', '-', '-C', libraryDir, '.']);
    tar.stdout.pipe(res);
    tar.stderr.on('data', (d: Buffer) => console.error('[tar]', d.toString()));
    tar.on('error', (err: Error) => { if (!res.headersSent) res.status(500).json({ error: 'Archive creation failed.' }); });
  });

  /**
   * GET /api/library/files/download?path=<filepath>
   * Streams a single library file as a download.
   */
  router.get('/files/download', async (req: Request, res: Response) => {
    const filePath = typeof req.query['path'] === 'string' ? req.query['path'] : '';
    try {
      const libraryDir = ensureLibraryDir();
      const resolved = await validateWorkspacePath(filePath, libraryDir);
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
    } catch (err) {
      res.status(400).json({ error: 'Operation failed.' });
    }
  });

  /**
   * POST /api/library/files/new-file?path=<subpath>&name=<filename>
   * Creates an empty file in the library.
   */
  router.post('/files/new-file', async (req: Request, res: Response) => {
    const subPath = typeof req.query['path'] === 'string' ? req.query['path'] : '.';
    const name = (typeof req.query['name'] === 'string' ? req.query['name'] : '').trim();
    if (!name || name.includes('/') || name === '.' || name === '..') {
      res.status(400).json({ error: 'Invalid file name.' });
      return;
    }
    try {
      const libraryDir = ensureLibraryDir();
      const targetPath = await validateWorkspacePath(path.join(subPath, name), libraryDir);
      await writeFile(targetPath, '', { flag: 'wx' });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: 'Operation failed.' });
    }
  });

  /**
   * POST /api/library/files/mkdir?path=<subpath>&name=<dirname>
   * Creates a new directory in the library.
   */
  router.post('/files/mkdir', async (req: Request, res: Response) => {
    const subPath = typeof req.query['path'] === 'string' ? req.query['path'] : '.';
    const name = (typeof req.query['name'] === 'string' ? req.query['name'] : '').trim();
    if (!name || name.includes('/') || name === '.' || name === '..') {
      res.status(400).json({ error: 'Invalid directory name.' });
      return;
    }
    try {
      const libraryDir = ensureLibraryDir();
      const targetPath = await validateWorkspacePath(path.join(subPath, name), libraryDir);
      await mkdir(targetPath);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: 'Operation failed.' });
    }
  });

  /**
   * DELETE /api/library/files?path=<filename>
   * Deletes a file from the shared library.
   */
  router.delete('/files', async (req: Request, res: Response) => {
    const filePath = typeof req.query['path'] === 'string' ? req.query['path'] : '';

    if (!filePath || filePath === '.') {
      res.status(400).json({ error: 'Cannot delete library root.' });
      return;
    }

    if (isProtectedLibraryPath(filePath)) {
      res.status(403).json({ error: 'Cannot delete system library files.' });
      return;
    }

    try {
      const libraryDir = ensureLibraryDir();
      const resolved = await validateWorkspacePath(filePath, libraryDir);
      await rm(resolved, { recursive: true, force: false });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: 'Operation failed.' });
    }
  });

  return router;
}
