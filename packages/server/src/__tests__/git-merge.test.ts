/**
 * Selective merge tests (Step 6).
 *
 * Tests:
 * 1. mergeDeliverables(branch) — .deliverables/ files appear on main
 * 2. mergeDeliverables(branch) — .working/ files do NOT appear on main
 * 3. mergeDeliverables(branch) — *.notebook.json does NOT appear on main
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import simpleGit from 'simple-git';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'git-merge-test-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function setupRepoWithTaskBranch() {
  const repoDir = path.join(tmpRoot, 'project');
  await mkdir(path.join(repoDir, '.deliverables'), { recursive: true });

  const git = simpleGit(repoDir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');

  // Initial commit on main with .deliverables/
  await writeFile(path.join(repoDir, '.deliverables', 'readme.txt'), 'initial', 'utf-8');
  await git.add('-A');
  await git.commit('init');

  // Create task branch
  await git.branch(['task/my-task']);

  // Add worktree
  const worktreePath = path.join(repoDir, '.worktrees', 'task-my-task');
  await git.raw(['worktree', 'add', worktreePath, 'task/my-task']);

  // Simulate work in worktree
  const wtGit = simpleGit(worktreePath);
  await mkdir(path.join(worktreePath, '.deliverables', 'src'), { recursive: true });
  await mkdir(path.join(worktreePath, '.working'), { recursive: true });

  await writeFile(path.join(worktreePath, '.deliverables', 'src', 'app.py'), 'print("hello")', 'utf-8');
  await writeFile(path.join(worktreePath, '.working', '.index.json'), '{}', 'utf-8');
  await writeFile(path.join(worktreePath, 'my-task.notebook.json'), '{"cells":[]}', 'utf-8');

  await wtGit.add('-A');
  await wtGit.commit('task work');

  const { GitManager } = await import('../git.js');
  return { repoDir, worktreePath, GitManager };
}

describe('mergeDeliverables', () => {
  it('.deliverables/ files appear on main after merge', async () => {
    const { repoDir, GitManager } = await setupRepoWithTaskBranch();

    const mainGit = new GitManager(repoDir);
    await mainGit.mergeDeliverables('task/my-task');

    // Check that .deliverables/src/app.py exists on main
    expect(existsSync(path.join(repoDir, '.deliverables', 'src', 'app.py'))).toBe(true);
  });

  it('.working/ files do NOT appear on main', async () => {
    const { repoDir, GitManager } = await setupRepoWithTaskBranch();

    const mainGit = new GitManager(repoDir);
    await mainGit.mergeDeliverables('task/my-task');

    // .working/ should not exist on main
    expect(existsSync(path.join(repoDir, '.working'))).toBe(false);
  });

  it('*.notebook.json does NOT appear on main', async () => {
    const { repoDir, GitManager } = await setupRepoWithTaskBranch();

    const mainGit = new GitManager(repoDir);
    await mainGit.mergeDeliverables('task/my-task');

    // notebook.json should not exist on main
    expect(existsSync(path.join(repoDir, 'my-task.notebook.json'))).toBe(false);
  });
});
