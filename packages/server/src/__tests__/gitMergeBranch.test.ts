/**
 * Tests for GitManager.deleteBranch and getMainBranch methods.
 *
 * Tests:
 * 1. deleteBranch — deletes local branch
 * 2. getMainBranch — returns main branch name
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import simpleGit from 'simple-git';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'git-merge-branch-test-'));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function setupRepoWithBranch() {
  const repoDir = path.join(tmpRoot, 'project');
  await mkdir(repoDir, { recursive: true });

  const git = simpleGit(repoDir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');

  // Initial commit on main
  await writeFile(path.join(repoDir, 'readme.txt'), 'initial content', 'utf-8');
  await git.add('-A');
  await git.commit('init');

  // Create feature branch
  await git.branch(['feature/test']);

  const { GitManager } = await import('../git.js');
  return { repoDir, git, GitManager };
}

describe('GitManager.deleteBranch', () => {
  it('deletes local branch', async () => {
    const { repoDir, git, GitManager } = await setupRepoWithBranch();

    const manager = new GitManager(repoDir);
    await manager.deleteBranch(repoDir, 'feature/test');

    // Verify branch is deleted
    const branches = await git.branch(['-l']);
    expect(branches.all).not.toContain('feature/test');
  });
});

describe('GitManager.getMainBranch', () => {
  it('returns master for repos initialized with master', async () => {
    const { repoDir, GitManager } = await setupRepoWithBranch();

    const manager = new GitManager(repoDir);
    const mainBranch = await manager.getMainBranch(repoDir);

    expect(mainBranch).toBe('master');
  });
});
