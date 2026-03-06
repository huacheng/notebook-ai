import simpleGit, { SimpleGit } from 'simple-git';

// ── D6: Exported constants ────────────────────────────────────────────────────

/** SHA-1 hash of the empty git tree object (for diffing the first commit) */
export const GIT_EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Default number of commits to fetch in getLog() */
export const DEFAULT_GIT_LOG_COUNT = 20;

/** Default git user email for auto-initialized repos */
export const DEFAULT_GIT_USER_EMAIL = 'notebook-ai@localhost';

/** Default git user name for auto-initialized repos */
export const DEFAULT_GIT_USER_NAME = 'Notebook AI';

export class GitManager {
  private git: SimpleGit;
  readonly repoRoot: string;

  constructor(cwd: string) {
    this.git = simpleGit(cwd);
    this.repoRoot = cwd;
  }

  /** Check if the cwd is a git repo */
  async isRepo(): Promise<boolean> {
    try {
      await this.git.revparse(['--is-inside-work-tree']);
      return true;
    } catch {
      return false;
    }
  }

  /** Initialize a git repo if not already one, and make an initial commit. */
  async ensureRepo(): Promise<void> {
    const already = await this.isRepo();
    if (!already) {
      await this.git.init();
      // Set a default identity so commits don't fail in environments without
      // a global git config.
      await this.git.addConfig('user.email', DEFAULT_GIT_USER_EMAIL);
      await this.git.addConfig('user.name', DEFAULT_GIT_USER_NAME);
      console.log('[git] Initialized new git repository.');

      // Stage all workspace files created during notebook setup and make the
      // initial commit so the repo has a clean baseline from the start.
      const status = await this.git.status();
      if (status.files.length > 0) {
        await this.git.add('-A');
        await this.git.commit('chore: init notebook workspace');
        console.log('[git] Created initial commit.');
      }
    }
  }

  /**
   * Auto-commit all changes after a cell execution.
   * Returns the diff string and list of changed files, or null if nothing to commit.
   */
  async commitCellExecution(
    cellId: string,
    prompt: string,
  ): Promise<{ diff: string; filesChanged: string[] } | null> {
    // 1. Check if there are any changes.
    const status = await this.git.status();
    const hasChanges =
      status.files.length > 0;

    // 2. Nothing to commit — return early.
    if (!hasChanges) {
      return null;
    }

    // 3. Stage everything.
    await this.git.add('-A');

    // 4. Build the commit message: first 50 chars of the prompt as summary.
    const summary = prompt.trim().slice(0, 50).replace(/\n/g, ' ');
    const commitMessage = `[notebook:${cellId}] ${summary}`;
    await this.git.commit(commitMessage);

    // 5. Get diff between this commit and the previous one.
    let diff = '';
    try {
      diff = await this.git.diff(['HEAD~1', 'HEAD']);
    } catch {
      // If there is no previous commit (i.e. this is the very first commit),
      // diff against the empty tree.
      const emptyTree = GIT_EMPTY_TREE_HASH;
      diff = await this.git.diff([emptyTree, 'HEAD']);
    }

    // 6. Collect the list of changed files.
    const show = await this.git.show(['--stat', '--format=', 'HEAD']);
    const filesChanged: string[] = show
      .split('\n')
      .filter((line) => line.includes('|') || line.match(/\d+ insertion|deletion/))
      .map((line) => line.trim().split('|')[0].trim())
      .filter(Boolean);

    // 7. Return result.
    return { diff, filesChanged };
  }

  /** Get the diff for a specific commit */
  async getDiff(commitHash: string): Promise<string> {
    try {
      return await this.git.diff([`${commitHash}~1`, commitHash]);
    } catch {
      // First commit — diff against empty tree.
      const emptyTree = GIT_EMPTY_TREE_HASH;
      return this.git.diff([emptyTree, commitHash]);
    }
  }

  /** Get recent commit log */
  async getLog(maxCount = DEFAULT_GIT_LOG_COUNT): Promise<Array<{ hash: string; message: string; date: string }>> {
    const log = await this.git.log({ maxCount });
    return log.all.map((entry) => ({
      hash: entry.hash,
      message: entry.message,
      date: entry.date,
    }));
  }

  // ── Worktree management ────────────────────────────────────

  /** Create a new local branch from the current HEAD */
  async createBranch(branchName: string): Promise<void> {
    await this.git.branch([branchName]);
  }

  /** Add a git worktree at the given path, checked out to the specified branch */
  async addWorktree(path: string, branch: string): Promise<void> {
    await this.git.raw(['worktree', 'add', path, branch]);
  }

  /** Remove a git worktree (force) */
  async removeWorktree(path: string): Promise<void> {
    await this.git.raw(['worktree', 'remove', path, '--force']);
  }

  /** Move a git worktree to a new path */
  async moveWorktree(oldPath: string, newPath: string): Promise<void> {
    await this.git.raw(['worktree', 'move', oldPath, newPath]);
  }

  /** Rename a git branch */
  async renameBranch(oldName: string, newName: string): Promise<void> {
    await this.git.raw(['branch', '-m', oldName, newName]);
  }

  /** Stage all files and commit with the given message */
  async commitAll(message: string): Promise<void> {
    await this.git.add('-A');
    await this.git.commit(message);
  }

  /**
   * Selectively merge only .deliverables/ from a task branch into the current branch.
   * Does NOT bring .working/ or *.notebook.json into main.
   */
  async mergeDeliverables(branch: string): Promise<void> {
    try {
      await this.git.raw(['checkout', branch, '--', '.deliverables/']);
    } catch {
      // Branch may not have .deliverables/ — nothing to merge
      return;
    }
    await this.git.add('.deliverables/');
    const status = await this.git.status();
    if (status.staged.length > 0) {
      await this.git.commit(`task-ai: merge deliverables from ${branch}`);
    }
  }

  /** List all worktrees and their checked-out branches */
  async listWorktrees(): Promise<Array<{ path: string; branch: string }>> {
    const output = await this.git.raw(['worktree', 'list', '--porcelain']);
    const worktrees: Array<{ path: string; branch: string }> = [];
    let current: { path?: string; branch?: string } = {};
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) current.path = line.slice(9);
      else if (line.startsWith('branch ')) current.branch = line.slice(7).replace('refs/heads/', '');
      else if (line === '') {
        if (current.path && current.branch) worktrees.push({ path: current.path, branch: current.branch });
        current = {};
      }
    }
    return worktrees;
  }

  /** Get the main branch name (master or main) */
  async getMainBranch(_repoDir: string): Promise<string> {
    const branches = await this.git.branch(['-l']);
    if (branches.all.includes('main')) return 'main';
    return 'master';
  }

  /**
   * Merge a branch into main/master with --no-ff.
   * Returns success status and message.
   */
  async mergeBranchToMain(_repoDir: string, branchName: string): Promise<{ success: boolean; message: string }> {
    const mainBranch = await this.getMainBranch(_repoDir);

    try {
      // Ensure we're on the main branch
      await this.git.checkout(mainBranch);

      // Merge with --no-ff to preserve branch history
      await this.git.merge([branchName, '--no-ff', '-m', `Merge branch '${branchName}' into ${mainBranch}`]);

      return { success: true, message: `Successfully merged ${branchName} into ${mainBranch}` };
    } catch (err) {
      // Abort the merge if it failed
      try {
        await this.git.merge(['--abort']);
      } catch {
        // Ignore abort errors
      }

      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('CONFLICT') || message.includes('conflict')) {
        return { success: false, message: `Merge conflict: ${branchName} has conflicts with ${mainBranch}` };
      }
      return { success: false, message: `Merge failed: ${message}` };
    }
  }

  /** Delete a local branch (force) */
  async deleteBranch(_repoDir: string, branchName: string): Promise<void> {
    await this.git.branch(['-D', branchName]);
  }
}
