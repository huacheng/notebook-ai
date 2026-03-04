/**
 * Tests for GitManager.mergeBranchToMain and deleteBranch methods.
 *
 * Tests:
 * 1. mergeBranchToMain — successfully merges branch to main
 * 2. mergeBranchToMain — returns conflict info when merge fails
 * 3. deleteBranch — deletes local branch
 * 4. getMainBranch — returns main branch name
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
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
  await git.checkout('feature/test');

  // Add a commit on feature branch
  await writeFile(path.join(repoDir, 'feature.txt'), 'feature content', 'utf-8');
  await git.add('-A');
  await git.commit('add feature');

  // Go back to main
  await git.checkout('master');

  const { GitManager } = await import('../git.js');
  return { repoDir, git, GitManager };
}

async function setupRepoWithConflict() {
  const repoDir = path.join(tmpRoot, 'project-conflict');
  await mkdir(repoDir, { recursive: true });

  const git = simpleGit(repoDir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');

  // Initial commit
  await writeFile(path.join(repoDir, 'file.txt'), 'initial', 'utf-8');
  await git.add('-A');
  await git.commit('init');

  // Create feature branch
  await git.branch(['feature/conflict']);
  await git.checkout('feature/conflict');

  // Modify file on feature branch
  await writeFile(path.join(repoDir, 'file.txt'), 'feature change', 'utf-8');
  await git.add('-A');
  await git.commit('feature change');

  // Go back to main and make conflicting change
  await git.checkout('master');
  await writeFile(path.join(repoDir, 'file.txt'), 'main change', 'utf-8');
  await git.add('-A');
  await git.commit('main change');

  const { GitManager } = await import('../git.js');
  return { repoDir, git, GitManager };
}

describe('GitManager.mergeBranchToMain', () => {
  it('successfully merges branch to main with --no-ff', async () => {
    const { repoDir, git, GitManager } = await setupRepoWithBranch();

    const manager = new GitManager(repoDir);
    const result = await manager.mergeBranchToMain(repoDir, 'feature/test');

    expect(result.success).toBe(true);
    expect(result.message).toContain('feature/test');

    // Verify the merge happened - feature.txt should exist
    const content = await readFile(path.join(repoDir, 'feature.txt'), 'utf-8');
    expect(content).toBe('feature content');

    // Verify we're still on main
    const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
    expect(branch.trim()).toBe('master');
  });

  it('returns conflict info when merge fails', async () => {
    const { repoDir, GitManager } = await setupRepoWithConflict();

    const manager = new GitManager(repoDir);
    const result = await manager.mergeBranchToMain(repoDir, 'feature/conflict');

    expect(result.success).toBe(false);
    expect(result.message).toContain('conflict');
  });
});

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
