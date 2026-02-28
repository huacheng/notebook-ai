import { Router, type IRouter } from 'express';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import type { NotebookDb } from '../db.js';
import { unquoteGitPath } from '../git-utils.js';

const execFile = promisify(execFileCb);
const EXEC_TIMEOUT = 10000;

interface CommitFile {
  path: string;
  additions: number;
  deletions: number;
}

interface RefInfo {
  type: 'head' | 'branch' | 'remote' | 'tag';
  name: string;
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

export function createGitRouter(db: NotebookDb): IRouter {
  const router = Router();

  // Git log with optional file filter
  router.get('/:projectId/git-log', async (req, res) => {
    const project = db.getProject(req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const cwd = project.path;

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 5));
    const file = req.query.file as string | undefined;
    if (file && (file.includes('..') || file.startsWith('/'))) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }
    const all = req.query.all === 'true';
    const branch = req.query.branch as string | undefined;
    if (branch && !/^[\w\-\/.]+$/.test(branch)) {
      res.status(400).json({ error: 'Invalid branch name' });
      return;
    }
    const skip = (page - 1) * limit;

    try {
      const SEP = '---GIT-LOG-SEP---';
      const format = `${SEP}%n%H%n%h%n%P%n%D%n%s%n%an%n%aI`;

      const args = ['log', '--topo-order', `--pretty=format:${format}`, '--numstat', `--skip=${skip}`, `-${limit + 1}`];
      if (all) args.splice(1, 0, '--all');
      if (branch && !all) args.push(branch);
      if (file) {
        args.push('--', file);
      }

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
        for (const fl of fileLines) {
          const match = fl.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
          if (match) {
            files.push({
              additions: match[1] === '-' ? 0 : parseInt(match[1], 10),
              deletions: match[2] === '-' ? 0 : parseInt(match[2], 10),
              path: unquoteGitPath(match[3]),
            });
          }
        }

        commits.push({ hash, shortHash, parents, refs, message, author, date, files });
      }

      const hasMore = commits.length > limit;
      if (hasMore) commits.pop();

      res.json({ commits, hasMore });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not a git repository')) {
        res.json({ commits: [], hasMore: false, error: 'Not a git repository' });
      } else {
        console.error('[api:git-log]', msg);
        res.status(500).json({ error: 'Failed to get git log' });
      }
    }
  });

  // Git diff for a specific commit
  router.get('/:projectId/git-diff', async (req, res) => {
    const project = db.getProject(req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const cwd = project.path;

    const commit = req.query.commit as string;
    if (!commit || !/^[a-f0-9]{7,40}$/.test(commit)) {
      res.status(400).json({ error: 'Invalid commit hash' });
      return;
    }
    const file = req.query.file as string | undefined;
    if (file && (file.includes('..') || file.startsWith('/'))) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }

    try {
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[api:git-diff]', msg);
      res.status(500).json({ error: 'Failed to get diff' });
    }
  });

  // Git branches list
  router.get('/:projectId/git-branches', async (req, res) => {
    const project = db.getProject(req.params.projectId);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const cwd = project.path;

    try {
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
        console.error('[api:git-branches]', msg);
        res.status(500).json({ error: 'Failed to get branches' });
      }
    }
  });

  return router;
}
