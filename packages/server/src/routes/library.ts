import { Router, type IRouter, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import { copyFile, unlink, stat, rm, writeFile, mkdir } from 'fs/promises';
import { createReadStream } from 'fs';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { ensureLibraryDir, ensureLibraryGit } from '../workspace.js';
import { listWorkspaceFiles, validateWorkspacePath } from '../workspace-files.js';
import { unquoteGitPath } from '../git-utils.js';

const execFile = promisify(execFileCb);
const EXEC_TIMEOUT = 10000;

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

  // ── Git endpoints ─────────────────────────────────────────────────────────

  interface RefInfo {
    type: 'head' | 'branch' | 'remote' | 'tag';
    name: string;
  }

  interface CommitFile {
    path: string;
    additions: number;
    deletions: number;
  }

  interface CommitInfo {
    hash: string;
    shortHash: string;
    parents: string[];
    refs: RefInfo[];
    message: string;
    author: string;
    date: string;
    files: CommitFile[];
  }

  /**
   * GET /api/library/git-log
   * Returns git commit history for the library directory.
   * Initializes git if not already a repo.
   */
  router.get('/git-log', async (req: Request, res: Response) => {
    try {
      const cwd = await ensureLibraryGit();

      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
      const stats = req.query.stats === 'true';
      const skip = (page - 1) * limit;

      const SEP = '---GIT-LOG-SEP---';
      const format = `${SEP}%n%H%n%h%n%P%n%D%n%s%n%an%n%aI`;

      const args = ['log', '--topo-order', `--pretty=format:${format}`, `--skip=${skip}`, `-${limit + 1}`];
      if (stats) args.splice(3, 0, '--numstat');

      const { stdout } = await execFile('git', args, { cwd, timeout: EXEC_TIMEOUT });

      const commits: CommitInfo[] = [];
      const blocks = stdout.split(SEP).filter((b) => b.trim());

      for (const block of blocks) {
        const rawLines = block.split('\n');
        if (rawLines[0] === '') rawLines.shift();
        if (rawLines.length < 7) continue;

        const [hash, shortHash, parentLine, refLine, message, author, date, ...fileLines] = rawLines;

        const parents = parentLine.trim() ? parentLine.trim().split(' ') : [];

        const refs: RefInfo[] = [];
        if (refLine.trim()) {
          for (const raw of refLine.split(',')) {
            const part = raw.trim();
            if (!part) continue;
            if (part.startsWith('HEAD -> ')) {
              refs.push({ type: 'head', name: part.slice(8) });
            } else if (part === 'HEAD') {
              refs.push({ type: 'head', name: 'HEAD' });
            } else if (part.startsWith('tag: ')) {
              refs.push({ type: 'tag', name: part.slice(5) });
            } else if (part.includes('/')) {
              refs.push({ type: 'remote', name: part });
            } else {
              refs.push({ type: 'branch', name: part });
            }
          }
        }

        const files: CommitFile[] = [];
        if (stats) {
          for (const fl of fileLines) {
            const trimmed = fl.trim();
            if (!trimmed) continue;
            const match = trimmed.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/);
            if (match) {
              files.push({
                path: unquoteGitPath(match[3]),
                additions: match[1] === '-' ? 0 : parseInt(match[1], 10),
                deletions: match[2] === '-' ? 0 : parseInt(match[2], 10),
              });
            }
          }
        }

        commits.push({ hash, shortHash, parents, refs, message, author, date, files });
      }

      const hasMore = commits.length > limit;
      if (hasMore) commits.pop();

      res.json({ commits, hasMore, page, limit });
    } catch (err: any) {
      // No commits yet is fine
      if (err.message?.includes('does not have any commits')) {
        res.json({ commits: [], hasMore: false, page: 1, limit: 20 });
        return;
      }
      console.error('[library] git-log error:', err);
      res.status(500).json({ error: 'Git log failed.' });
    }
  });

  /**
   * GET /api/library/git-diff?commit=<hash>&file=<path>
   * Returns the diff for a specific commit, optionally filtered by file.
   */
  router.get('/git-diff', async (req: Request, res: Response) => {
    const commit = req.query.commit as string | undefined;
    const file = req.query.file as string | undefined;
    if (!commit || !/^[a-f0-9]{7,40}$/i.test(commit)) {
      res.status(400).json({ error: 'Invalid commit hash' });
      return;
    }

    try {
      const cwd = await ensureLibraryGit();

      // Use diff against parent to get proper diff (handles root commit too)
      let args: string[];
      try {
        await execFile('git', ['rev-parse', `${commit}~1`], { cwd, timeout: EXEC_TIMEOUT });
        args = ['diff', `${commit}~1`, commit];
      } catch {
        // Root commit — use diff-tree which handles --root correctly
        args = ['diff-tree', '-p', '--root', commit];
      }

      if (file) {
        args.push('--', file);
      }

      const { stdout } = await execFile('git', args, { cwd, timeout: EXEC_TIMEOUT, maxBuffer: 10 * 1024 * 1024 });
      res.json({ diff: stdout });
    } catch (err) {
      console.error('[library] git-diff error:', err);
      res.status(500).json({ error: 'Git diff failed.' });
    }
  });

  /**
   * GET /api/library/git-commit-files?commit=<hash>
   * Returns the list of files changed in a specific commit.
   */
  router.get('/git-commit-files', async (req: Request, res: Response) => {
    const commit = req.query.commit as string | undefined;
    if (!commit || !/^[a-f0-9]{7,40}$/i.test(commit)) {
      res.status(400).json({ error: 'Invalid commit hash' });
      return;
    }

    try {
      const cwd = await ensureLibraryGit();
      const { stdout } = await execFile(
        'git',
        ['diff-tree', '--no-commit-id', '-r', '--numstat', commit],
        { cwd, timeout: EXEC_TIMEOUT },
      );

      const files: CommitFile[] = [];
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

      res.json({ files });
    } catch (err) {
      console.error('[library] git-commit-files error:', err);
      res.status(500).json({ error: 'Failed to get commit files' });
    }
  });

  /**
   * GET /api/library/git-branches
   * Returns the list of branches for the library directory.
   */
  router.get('/git-branches', async (req: Request, res: Response) => {
    try {
      const cwd = await ensureLibraryGit();
      const { stdout } = await execFile('git', ['branch', '-a', '--no-color'], { cwd, timeout: EXEC_TIMEOUT });
      const branches: string[] = [];
      let current = '';

      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('* ')) {
          current = trimmed.slice(2);
          branches.push(current);
        } else {
          branches.push(trimmed);
        }
      }

      res.json({ current, branches });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not a git repository')) {
        res.json({ current: '', branches: [] });
      } else {
        console.error('[library] git-branches error:', msg);
        res.status(500).json({ error: 'Failed to get branches' });
      }
    }
  });

  return router;
}
